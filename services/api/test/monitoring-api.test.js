import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createApiApp } from "../src/app.js";
import { createIncidentService } from "../src/incident-service.js";
import { createMongoIncidentRepository } from "../src/incident-repository.js";
import { createMonitoringService } from "../src/monitoring-service.js";

const token = "test-monitor-ingest-token-at-least-24";
const policy = {
  intervalMs: 1_000,
  timeoutMs: 100,
  failureThreshold: 3,
  recoveryThreshold: 2,
};

function createMemoryRepository() {
  const checks = new Map();
  const states = new Map();
  const incidents = new Map();

  return {
    async insertCheck(check) {
      if (checks.has(check.checkId)) return false;
      checks.set(check.checkId, structuredClone(check));
      return true;
    },
    async getMonitoringState(applicationId) {
      return structuredClone(states.get(applicationId) ?? null);
    },
    async saveMonitoringState(state) {
      states.set(state.applicationId, structuredClone(state));
      return structuredClone(state);
    },
    async getRecentChecks(applicationId, limit) {
      return [...checks.values()]
        .filter((check) => check.applicationId === applicationId)
        .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt))
        .slice(0, limit)
        .map((check) => structuredClone(check));
    },
    async getActiveIncident(applicationId) {
      return structuredClone(
        [...incidents.values()].find((incident) => incident.activeApplicationId === applicationId) ?? null,
      );
    },
    async createIncident(incident) {
      if ([...incidents.values()].some((item) => item.activeApplicationId === incident.applicationId)) {
        const error = new Error("Duplicate active incident.");
        error.code = 11000;
        throw error;
      }
      incidents.set(incident.incidentId, structuredClone(incident));
      return structuredClone(incident);
    },
    async updateIncident(
      incidentId,
      changes,
      {
        clearActiveApplicationId = false,
        event = null,
        expectedStatus = null,
      } = {},
    ) {
      const incident = incidents.get(incidentId);
      if (!incident || (expectedStatus && incident.status !== expectedStatus)) return null;
      Object.assign(incident, structuredClone(changes));
      if (clearActiveApplicationId) delete incident.activeApplicationId;
      if (event) incident.timeline.push(structuredClone(event));
      return structuredClone(incident);
    },
    async appendIncidentEvent(incidentId, event) {
      const incident = incidents.get(incidentId);
      if (!incident) return null;
      if (!incident.timeline.some((item) => item.eventId === event.eventId)) {
        incident.timeline.push(structuredClone(event));
      }
      incident.updatedAt = event.timestamp;
      return structuredClone(incident);
    },
    async addLinkedReport(incidentId, report, event) {
      const incident = incidents.get(incidentId);
      if (!incident) return null;
      incident.reports ??= [];
      incident.reports.push(structuredClone(report));
      incident.timeline.push(structuredClone(event));
      incident.updatedAt = event.timestamp;
      return structuredClone(incident);
    },
    async findIncident(incidentId) {
      return structuredClone(incidents.get(incidentId) ?? null);
    },
    async listIncidents({
      active = false,
      status = null,
      source = null,
      severity = null,
      applicationId = null,
      limit = 50,
    } = {}) {
      return [...incidents.values()]
        .filter((incident) => !active || incident.isActive === true || incident.activeApplicationId !== undefined)
        .filter((incident) => !status || (Array.isArray(status)
          ? status.includes(incident.status)
          : incident.status === status))
        .filter((incident) => !source || (Array.isArray(source)
          ? source.includes(incident.source)
          : incident.source === source))
        .filter((incident) => !severity || (Array.isArray(severity)
          ? severity.includes(incident.severity)
          : incident.severity === severity))
        .filter((incident) => !applicationId || incident.applicationId === applicationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map((incident) => {
          const { activeApplicationId, lastProcessedCheckId, ...visible } = incident;
          return structuredClone(visible);
        });
    },
  };
}

async function startServer(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function makeCheck({ status = "unavailable", httpStatus = 503, failureReason = "http_status", checkedAt } = {}) {
  return {
    checkId: randomUUID(),
    checkedAt: checkedAt ?? new Date().toISOString(),
    status,
    httpStatus,
    latencyMs: 12.5,
    failureReason: status === "healthy" ? null : failureReason,
    checks: { process: "ok", mongodb: status === "healthy" ? "ok" : "unavailable" },
  };
}

test("Mongo incident repository reports a lost expected-status update as a conflict", async () => {
  let findCount = 0;
  const repository = createMongoIncidentRepository({
    collection(name) {
      if (name !== "incidents") return {};
      return {
        async updateOne() {
          return { matchedCount: 0, modifiedCount: 0 };
        },
        async findOne() {
          findCount += 1;
          return { incidentId: "stale-read", status: "open" };
        },
      };
    },
  });

  const updated = await repository.updateIncident(
    randomUUID(),
    { status: "investigating" },
    { expectedStatus: "open" },
  );

  assert.equal(updated, null);
  assert.equal(findCount, 0);
});

async function postCheck(baseUrl, check, headers = {}) {
  return fetch(`${baseUrl}/api/v1/monitoring/checks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify({
      applicationId: "demo-app",
      applicationName: "Demo application",
      check,
    }),
  });
}

function makeApp() {
  const repository = createMemoryRepository();
  const incidentService = createIncidentService({ repository });
  const monitoringService = createMonitoringService({
    repository,
    policy,
    idFactory: randomUUID,
    incidentService,
  });
  return {
    repository,
    app: createApiApp({
      monitoringService,
      incidentService,
      applicationId: "demo-app",
      applicationName: "Demo application",
      ingestToken: token,
    }),
  };
}

test("monitoring API requires authentication and validates events", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);
  const check = makeCheck();

  const unauthorized = await postCheck(baseUrl, check, { authorization: "Bearer wrong-token" });
  assert.equal(unauthorized.status, 401);

  const invalid = await fetch(`${baseUrl}/api/v1/monitoring/checks`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ applicationId: "demo-app" }),
  });
  assert.equal(invalid.status, 400);
});

test("three consecutive failures create one active incident and update its evidence", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);

  const first = await postCheck(baseUrl, makeCheck());
  const second = await postCheck(baseUrl, makeCheck());
  assert.equal((await first.json()).incident, null);
  assert.equal((await second.json()).incident, null);

  const thirdResponse = await postCheck(baseUrl, makeCheck());
  const third = await thirdResponse.json();
  assert.equal(thirdResponse.status, 202);
  assert.equal(third.incident.status, "open");
  assert.equal(third.incident.source, "monitoring");
  assert.equal(third.incident.severity, "critical");
  assert.equal(third.incident.isActive, true);
  assert.equal(third.incident.recoveryStatus, "not_started");
  assert.ok(third.incident.timeline.some((event) => event.eventType === "incident_created"));
  assert.equal(third.incident.failureCount, 3);
  assert.equal(third.incident.healthChecks.length, 1);
  assert.ok(third.incident.applicationId);
  assert.ok(third.incident.detectedAt);
  assert.ok(third.incident.lastObservedFailure);

  const fourth = await (await postCheck(baseUrl, makeCheck())).json();
  assert.equal(fourth.incident.incidentId, third.incident.incidentId);
  assert.equal(fourth.incident.failureCount, 4);
  assert.equal(fourth.incident.healthChecks.length, 2);

  const active = await fetch(`${baseUrl}/api/v1/incidents?active=true`);
  const body = await active.json();
  assert.equal(body.count, 1);
});

test("duplicate check IDs do not increment the failure count twice", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);
  const repeated = makeCheck();

  await postCheck(baseUrl, repeated);
  await postCheck(baseUrl, repeated);
  const status = await fetch(`${baseUrl}/api/v1/monitoring/status`);
  const body = await status.json();

  assert.equal(body.application.consecutiveFailedChecks, 1);
  assert.equal(body.monitoring.recentChecks.length, 1);
});

test("incident resolves only after the configured consecutive healthy checks", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);
  for (let index = 0; index < policy.failureThreshold; index += 1) {
    await postCheck(baseUrl, makeCheck());
  }

  const firstHealthy = await postCheck(baseUrl, makeCheck({
    status: "healthy",
    httpStatus: 200,
    failureReason: null,
  }));
  assert.equal((await firstHealthy.json()).incident.status, "open");

  const secondHealthy = await postCheck(baseUrl, makeCheck({
    status: "healthy",
    httpStatus: 200,
    failureReason: null,
  }));
  const resolved = await secondHealthy.json();
  assert.equal(resolved.incident.status, "resolved");
  assert.ok(resolved.incident.resolvedAt);
  assert.equal(resolved.incident.recoveryStatus, "verified");
  assert.equal(resolved.incident.isActive, false);
  assert.equal(resolved.incident.recoveryCheck.status, "healthy");
  assert.ok(resolved.incident.timeline.some((event) => event.eventType === "recovery_verified"));

  const active = await (await fetch(`${baseUrl}/api/v1/incidents?active=true`)).json();
  assert.equal(active.count, 0);
  const all = await (await fetch(`${baseUrl}/api/v1/incidents`)).json();
  assert.equal(all.count, 1);
});

test("incident detail and query validation return safe, useful API responses", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);
  for (let index = 0; index < policy.failureThreshold; index += 1) {
    await postCheck(baseUrl, makeCheck());
  }
  const incidents = await (await fetch(`${baseUrl}/api/v1/incidents`)).json();
  const incidentId = incidents.incidents[0].incidentId;

  const detail = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).incident.incidentId, incidentId);
  assert.equal((await fetch(`${baseUrl}/api/v1/incidents/not-a-uuid`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/v1/incidents?limit=1000`)).status, 400);
});

test("dashboard and teammate reports create records in the same incident system", async (t) => {
  const { app, repository } = makeApp();
  const baseUrl = await startServer(app, t);
  const dashboardResponse = await fetch(`${baseUrl}/api/v1/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "manual_dashboard",
      applicationId: "demo-app",
      applicationName: "Demo application",
      title: "Checkout page is slow",
      description: "Customers report long waits during checkout.",
      reporter: { name: "Ari" },
    }),
  });
  assert.equal(dashboardResponse.status, 201);
  const dashboardIncident = (await dashboardResponse.json()).incident;

  const teamResponse = await fetch(`${baseUrl}/api/v1/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "team_report",
      applicationId: "demo-app",
      applicationName: "Demo application",
      title: "Checkout errors reported in support",
      description: "A teammate reported customer-facing checkout errors.",
      reporter: { id: "u-17", name: "Sam" },
      report: {
        originalMessage: "Several customers are seeing checkout errors.",
        platform: "slack",
        channelReference: "support-incidents",
        messageTimestamp: "2026-11-05T06:00:00.000Z",
      },
    }),
  });
  assert.equal(teamResponse.status, 201);
  const teamIncident = (await teamResponse.json()).incident;

  assert.notEqual(dashboardIncident.incidentId, teamIncident.incidentId);
  assert.equal(dashboardIncident.source, "manual_dashboard");
  assert.equal(dashboardIncident.reporter.name, "Ari");
  assert.equal(teamIncident.source, "team_report");
  assert.deepEqual(teamIncident.reporter, { id: "u-17", name: "Sam" });
  assert.equal(teamIncident.reports[0].originalMessage, "Several customers are seeing checkout errors.");
  assert.equal(teamIncident.reports[0].platform, "slack");
  assert.equal(teamIncident.reports[0].channelReference, "support-incidents");
  assert.equal(teamIncident.reports[0].messageTimestamp, "2026-11-05T06:00:00.000Z");
  assert.equal(teamIncident.severity, "medium");
  assert.equal(teamIncident.status, "open");
  assert.equal(teamIncident.isActive, true);
  assert.ok(teamIncident.timeline.some((event) => event.eventType === "incident_created"));
  assert.equal((await repository.listIncidents({ limit: 50 })).length, 2);

  const filtered = await fetch(
    `${baseUrl}/api/v1/incidents?source=team_report&severity=medium&status=open`,
  );
  const filteredBody = await filtered.json();
  assert.equal(filteredBody.count, 1);
  assert.equal(filteredBody.incidents[0].incidentId, teamIncident.incidentId);
});

test("report linking and incident history preserve events without title-based merging", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);
  const create = (source, reporterName) => fetch(`${baseUrl}/api/v1/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source,
      applicationId: "demo-app",
      applicationName: "Demo application",
      title: "Database latency",
      description: "Database requests are responding slowly.",
      reporter: { name: reporterName },
    }),
  });
  const first = (await (await create("manual_dashboard", "Ari")).json()).incident;
  const second = (await (await create("manual_dashboard", "Sam")).json()).incident;
  assert.notEqual(first.incidentId, second.incidentId);

  const linkResponse = await fetch(
    `${baseUrl}/api/v1/incidents/${first.incidentId}/reports`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reporter: { id: "u-22", name: "Lee" },
        report: {
          originalMessage: "Seeing increased database latency from the API.",
          platform: "discord",
          channelReference: "thread-593",
          messageTimestamp: "2026-11-05T06:15:00Z",
        },
      }),
    },
  );
  assert.equal(linkResponse.status, 201);
  const linkedIncident = (await linkResponse.json()).incident;
  assert.equal(linkedIncident.reports.length, 1);
  assert.equal(linkedIncident.reports[0].platform, "discord");

  const historyResponse = await fetch(
    `${baseUrl}/api/v1/incidents/${first.incidentId}/history`,
  );
  assert.equal(historyResponse.status, 200);
  const events = (await historyResponse.json()).events;
  assert.deepEqual(events.map((event) => event.eventType), [
    "incident_created",
    "report_linked",
  ]);
  assert.ok(events.every((event) =>
    event.incidentId === first.incidentId &&
    typeof event.timestamp === "string" &&
    typeof event.author === "string" &&
    typeof event.message === "string" &&
    event.metadata,
  ));
});

test("status changes are recorded and cannot resolve an unverified incident", async (t) => {
  const { app } = makeApp();
  const baseUrl = await startServer(app, t);
  const created = await fetch(`${baseUrl}/api/v1/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "manual_dashboard",
      applicationId: "demo-app",
      applicationName: "Demo application",
      title: "API response errors",
      description: "The application is returning intermittent errors.",
      reporter: { name: "Ari" },
    }),
  });
  const incident = (await created.json()).incident;

  const updateResponse = await fetch(`${baseUrl}/api/v1/incidents/${incident.incidentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "investigating",
      assignedTo: "Sam",
      investigationSummary: "Reviewing recent application errors.",
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).incident;
  assert.equal(updated.status, "investigating");
  assert.equal(updated.assignedTo, "Sam");
  assert.equal(updated.investigationSummary, "Reviewing recent application errors.");
  assert.ok(updated.timeline.some((event) => event.eventType === "status_changed"));

  const invalidResolution = await fetch(`${baseUrl}/api/v1/incidents/${incident.incidentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  });
  assert.equal(invalidResolution.status, 409);

  const unsupportedField = await fetch(`${baseUrl}/api/v1/incidents/${incident.incidentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ activeApplicationId: "another-app" }),
  });
  assert.equal(unsupportedField.status, 409);
});
