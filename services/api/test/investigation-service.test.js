import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createIncidentService } from "../src/incident-service.js";
import { createInvestigationService } from "../src/investigation-service.js";

const clone = (value) => structuredClone(value);

function createMemoryRepository() {
  const incidents = new Map();

  return {
    async getActiveIncident(applicationId) {
      return clone([...incidents.values()].find((item) =>
        item.activeApplicationId === applicationId) ?? null);
    },
    async createIncident(incident) {
      incidents.set(incident.incidentId, clone(incident));
      return clone(incident);
    },
    async findIncident(incidentId) {
      return clone(incidents.get(incidentId) ?? null);
    },
    async getIncidentHistory(incidentId) {
      return clone(incidents.get(incidentId)?.timeline ?? null);
    },
    async appendIncidentEvent(incidentId, event) {
      const incident = incidents.get(incidentId);
      if (!incident) return null;
      incident.timeline.push(clone(event));
      incident.updatedAt = event.timestamp;
      return clone(incident);
    },
    async claimInvestigation(incidentId, { attemptId, startedAt, staleBefore, event }) {
      const incident = incidents.get(incidentId);
      if (!incident || !["open", "investigating", "awaiting_approval", "failed"].includes(incident.status)) {
        return null;
      }
      const existing = incident.investigation;
      const runningAndFresh = existing?.status === "running" &&
        Date.parse(existing.startedAt) >= Date.parse(staleBefore);
      if (runningAndFresh) return null;

      incident.status = "investigating";
      incident.isActive = true;
      incident.updatedAt = startedAt;
      incident.investigation = {
        ...existing,
        status: "running",
        attemptId,
        startedAt,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        error: null,
      };
      incident.timeline.push(clone(event));
      return clone(incident);
    },
    async completeInvestigation(incidentId, { attemptId, completedAt, diagnosis, event }) {
      const incident = incidents.get(incidentId);
      if (incident?.investigation?.status !== "running" ||
          incident.investigation.attemptId !== attemptId) return null;
      incident.updatedAt = completedAt;
      incident.investigation = {
        ...incident.investigation,
        status: "completed",
        completedAt,
        diagnosis: clone(diagnosis),
        error: null,
      };
      incident.timeline.push(clone(event));
      return clone(incident);
    },
    async failInvestigation(incidentId, { attemptId, failedAt, failure, event }) {
      const incident = incidents.get(incidentId);
      if (incident?.investigation?.status !== "running" ||
          incident.investigation.attemptId !== attemptId) return null;
      incident.updatedAt = failedAt;
      incident.investigation = {
        ...incident.investigation,
        status: "failed",
        failedAt,
        error: clone(failure),
      };
      incident.timeline.push(clone(event));
      return clone(incident);
    },
  };
}

const goodDiagnosis = () => ({
  summary: "The health endpoint reports the database dependency unavailable.",
  probableCause: "The application's database connection is failing.",
  evidence: [{
    source: "currentApplicationHealth.response.checks.mongodb",
    observation: "MongoDB readiness is reported as unavailable.",
    classification: "confirmed_fact",
  }],
  relevantLogExcerpts: [],
  confidence: 0.72,
  recommendedInvestigationSteps: ["Inspect database connectivity from the application host."],
  recommendedAction: "Verify database availability before considering a recovery operation.",
  risk: "Restarting the app will not fix an unavailable database.",
  missingInformation: [],
  requiresHumanApproval: true,
});

async function createFixture({
  source = "monitoring",
  healthStatus = 200,
  healthBody = { status: "ok", service: "demo-app", scope: "application-readiness", checks: { mongodb: "ok" } },
  diagnosisClient = { investigate: async () => goodDiagnosis() },
  fetchImpl,
} = {}) {
  const repository = createMemoryRepository();
  const incidentService = createIncidentService({ repository });
  const reporter = source === "monitoring" ? null : { id: "teammate-1", name: "Alex" };
  const created = await incidentService.createIncident({
    source,
    applicationId: "demo-app",
    applicationName: "Demo application",
    title: "Health endpoint unavailable",
    description: "The application is reporting unhealthy.",
    reporter,
    ...(source === "team_report"
      ? {
        report: {
          originalMessage: "Checkout is unavailable for customers.",
          platform: "slack",
          channelReference: "#on-call",
          messageTimestamp: new Date().toISOString(),
        },
      }
      : {}),
    ...(source === "monitoring"
      ? {
        lastObservedFailure: {
          checkId: randomUUID(),
          checkedAt: new Date().toISOString(),
          status: "unavailable",
          httpStatus: 503,
          latencyMs: 25,
          failureReason: "http_status",
          checks: { mongodb: "unavailable" },
        },
      }
      : {}),
  });
  const monitoringService = {
    async getMonitoringStatus() {
      return {
        application: {
          latestCheck: {
            status: "unavailable",
            httpStatus: 503,
            failureReason: "http_status",
            checks: { mongodb: "unavailable" },
          },
          consecutiveFailedChecks: 3,
        },
        monitoring: {
          status: "active",
          recentChecks: [{
            checkId: randomUUID(),
            checkedAt: new Date().toISOString(),
            status: "unavailable",
            httpStatus: 503,
            latencyMs: 22,
            failureReason: "http_status",
            checks: { mongodb: "unavailable" },
          }],
        },
      };
    },
  };
  const defaultFetch = async (url) => {
    const endpoint = new URL(url);
    if (endpoint.pathname === "/health") {
      return new Response(JSON.stringify(healthBody), {
        status: healthStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      releaseId: "demo-release-7",
      version: "7",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const service = createInvestigationService({
    incidentService,
    monitoringService,
    diagnosisClient,
    applicationUrl: "http://demo.local",
    fetchImpl: fetchImpl ?? defaultFetch,
  });
  return { incidentService, service, incident: created.incident };
}

test("one investigation flow accepts monitoring, teammate, and dashboard incidents", async () => {
  for (const source of ["monitoring", "team_report", "manual_dashboard"]) {
    const fixture = await createFixture({ source });
    const result = await fixture.service.investigate(fixture.incident.incidentId, {
      requestedBy: "Alex",
    });

    assert.equal(result.incident.source, source);
    assert.equal(result.incident.status, "investigating");
    assert.equal(result.incident.investigation.status, "completed");
    assert.equal(result.incident.investigation.diagnosis.requiresHumanApproval, true);
    assert.equal(
      result.incident.timeline.some((event) => event.eventType === "investigation_started" &&
        event.author === "Alex"),
      true,
    );
    if (source === "team_report") {
      assert.equal(result.incident.reports[0].originalMessage, "Checkout is unavailable for customers.");
    }
  }
});

test("investigation context contains health, version, monitoring, history, and explicit data gaps", async () => {
  const fixture = await createFixture({
    source: "team_report",
    healthStatus: 503,
    healthBody: {
      status: "unavailable",
      service: "demo-app",
      scope: "application-readiness",
      checks: { process: "ok", mongodb: "unavailable" },
    },
  });
  const context = await fixture.service.collectContext(fixture.incident);

  assert.equal(context.incident.source, "team_report");
  assert.equal(context.teammateReports[0].originalMessage, "Checkout is unavailable for customers.");
  assert.equal(context.currentApplicationHealth.available, false);
  assert.equal(context.currentApplicationHealth.httpStatus, 503);
  assert.equal(context.currentApplicationHealth.response.checks.mongodb, "unavailable");
  assert.equal(context.monitoring.recentChecks.length, 1);
  assert.equal(context.currentDeployment.release.releaseId, "demo-release-7");
  assert.deepEqual(context.applicationLogs.entries, []);
  assert.deepEqual(context.deploymentHistory.entries, []);
  assert.ok(context.limitations.some((item) => item.includes("Application logs are unavailable")));
  assert.ok(context.limitations.some((item) => item.includes("Deployment history is unavailable")));
  assert.ok(context.timeline.some((event) => event.eventType === "incident_created"));
});

test("database health failures are passed through as evidence, not treated as a diagnosis", async () => {
  const fixture = await createFixture({
    healthStatus: 503,
    healthBody: {
      status: "unavailable",
      service: "demo-app",
      checks: { process: "ok", mongodb: "unavailable" },
    },
  });
  let receivedContext;
  fixture.service = createInvestigationService({
    incidentService: fixture.incidentService,
    monitoringService: {
      getMonitoringStatus: async () => ({
        application: { latestCheck: null, consecutiveFailedChecks: 3 },
        monitoring: { status: "active", recentChecks: [] },
      }),
    },
    diagnosisClient: {
      investigate: async (context) => {
        receivedContext = context;
        return goodDiagnosis();
      },
    },
    applicationUrl: "http://demo.local",
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/health") {
        return new Response(JSON.stringify({
          status: "unavailable",
          checks: { process: "ok", mongodb: "unavailable" },
        }), { status: 503 });
      }
      return new Response(JSON.stringify({ releaseId: "release-a", version: "1" }), { status: 200 });
    },
  });

  const result = await fixture.service.investigate(fixture.incident.incidentId);
  assert.equal(receivedContext.currentApplicationHealth.response.checks.mongodb, "unavailable");
  assert.equal(result.incident.investigation.diagnosis.probableCause, goodDiagnosis().probableCause);
});

test("only collected context is marked confirmed and unavailable logs are never returned as excerpts", async () => {
  const fixture = await createFixture({
    healthStatus: 503,
    healthBody: {
      status: "unavailable",
      service: "demo-app",
      checks: { process: "ok", mongodb: "unavailable" },
    },
    diagnosisClient: {
      investigate: async () => ({
        ...goodDiagnosis(),
        evidence: [{
          source: "invented deployment log",
          observation: "A recent deploy caused the database failure.",
          classification: "confirmed_fact",
        }],
        relevantLogExcerpts: ["A fabricated log line."],
      }),
    },
  });

  const result = await fixture.service.investigate(fixture.incident.incidentId);
  const savedDiagnosis = result.incident.investigation.diagnosis;

  assert.ok(savedDiagnosis.evidence.some((item) =>
    item.classification === "confirmed_fact" &&
    item.source === "Current health endpoint" &&
    item.observation.includes("HTTP 503")));
  assert.ok(savedDiagnosis.evidence.some((item) =>
    item.classification === "confirmed_fact" &&
    item.source === "Health dependency check" &&
    item.observation.includes('mongodb: "unavailable"')));
  assert.ok(savedDiagnosis.evidence.some((item) =>
    item.classification === "hypothesis" &&
    item.source === "AI-generated hypothesis" &&
    item.observation.includes("invented deployment log")));
  assert.deepEqual(savedDiagnosis.relevantLogExcerpts, []);
});

test("unavailable endpoints are recorded as missing context and remain retryable", async () => {
  const fixture = await createFixture({
    diagnosisClient: { investigate: async () => goodDiagnosis() },
    fetchImpl: async () => {
      const error = new Error("simulated network timeout");
      error.name = "TimeoutError";
      throw error;
    },
  });
  const result = await fixture.service.investigate(fixture.incident.incidentId);
  assert.equal(result.incident.investigation.status, "completed");
  assert.ok(result.diagnosis.missingInformation.some((item) => item.includes("Application logs are unavailable")));
  assert.ok(result.diagnosis.missingInformation.some((item) => item.includes("Endpoint request timed out")));
  assert.equal(result.incident.status, "investigating");
});

test("provider failures are persisted and a later investigation can retry", async () => {
  let attempts = 0;
  const fixture = await createFixture({
    diagnosisClient: {
      async investigate() {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unavailable");
        return goodDiagnosis();
      },
    },
  });

  await assert.rejects(
    fixture.service.investigate(fixture.incident.incidentId),
    /provider unavailable/,
  );
  const failed = await fixture.incidentService.getIncident(fixture.incident.incidentId);
  assert.equal(failed.investigation.status, "failed");
  assert.equal(failed.investigation.error.code, "INVESTIGATION_FAILED");
  assert.ok(failed.timeline.some((event) => event.eventType === "investigation_failed"));

  const retried = await fixture.service.investigate(fixture.incident.incidentId);
  assert.equal(retried.incident.investigation.attemptCount, 2);
  assert.equal(retried.incident.investigation.status, "completed");
});

test("concurrent requests cannot start duplicate investigations for one incident", async () => {
  let releaseDiagnosis;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const fixture = await createFixture({
    diagnosisClient: {
      investigate: async () => {
        signalStarted();
        return new Promise((resolve) => {
          releaseDiagnosis = resolve;
        });
      },
    },
  });

  const first = fixture.service.investigate(fixture.incident.incidentId);
  await started;
  await assert.rejects(
    fixture.service.investigate(fixture.incident.incidentId),
    (error) => error.code === "INVESTIGATION_IN_PROGRESS",
  );
  releaseDiagnosis(goodDiagnosis());
  const result = await first;
  assert.equal(result.incident.investigation.attemptCount, 1);
});
