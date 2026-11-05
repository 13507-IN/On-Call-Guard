import { randomUUID } from "node:crypto";
import {
  mergeDiagnosisLimitations,
  validateDiagnosis,
} from "@oncall/shared/diagnosis";

const MAX_ENDPOINT_BODY_CHARS = 24_000;

function safeHealthBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const checks = value.checks && typeof value.checks === "object" && !Array.isArray(value.checks)
    ? Object.fromEntries(
      Object.entries(value.checks).slice(0, 12).map(([key, item]) => [
        key.slice(0, 40),
        typeof item === "string" ? item.slice(0, 80) : "unknown",
      ]),
    )
    : {};
  return {
    status: typeof value.status === "string" ? value.status.slice(0, 40) : null,
    service: typeof value.service === "string" ? value.service.slice(0, 100) : null,
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt.slice(0, 64) : null,
    scope: typeof value.scope === "string" ? value.scope.slice(0, 80) : null,
    checks,
  };
}

async function fetchEndpoint(url, { timeoutMs, fetchImpl }) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (text.length > MAX_ENDPOINT_BODY_CHARS) {
      return {
        available: true,
        httpStatus: response.status,
        body: null,
        limitation: "The endpoint response exceeded the investigation size limit.",
      };
    }

    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON responses are not useful as structured investigation evidence.
    }
    return {
      available: response.ok,
      httpStatus: response.status,
      body,
      ...(!response.ok ? { limitation: `Endpoint returned HTTP ${response.status}.` } : {}),
      ...(response.ok && body === null
        ? { limitation: "Endpoint did not return JSON." }
        : {}),
    };
  } catch (error) {
    return {
      available: false,
      httpStatus: null,
      body: null,
      limitation: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "Endpoint request timed out."
        : "Endpoint could not be reached.",
    };
  }
}

function validateApplicationUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MONITORED_APP_URL must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("MONITORED_APP_URL must not contain credentials.");
  }
  url.hash = "";
  return url;
}

function summarizeChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.slice(0, 20).map((check) => ({
    checkId: check.checkId,
    checkedAt: check.checkedAt,
    status: check.status,
    httpStatus: check.httpStatus,
    latencyMs: check.latencyMs,
    failureReason: check.failureReason,
    checks: check.checks,
  }));
}

function groundDiagnosisEvidence(diagnosis, context) {
  const verifiedEvidence = [];
  const addFact = (source, observation) => {
    if (typeof observation !== "string" || observation.length === 0) return;
    verifiedEvidence.push({
      source,
      observation: observation.slice(0, 1_000),
      classification: "confirmed_fact",
    });
  };

  const { incident } = context;
  addFact(
    "Incident record",
    `Incident ${incident.incidentId} is recorded as ${incident.source}, severity ${incident.severity}, status ${incident.status}.`,
  );
  if (incident.description) {
    addFact("Incident record", `Recorded description: ${incident.description}`);
  }

  for (const report of (context.teammateReports ?? []).slice(0, 5)) {
    if (report.originalMessage) {
      addFact(
        "Teammate report",
        `The stored teammate report states: ${report.originalMessage}`,
      );
    }
  }

  const health = context.currentApplicationHealth;
  if (health.httpStatus !== null) {
    addFact("Current health endpoint", `The health endpoint returned HTTP ${health.httpStatus}.`);
  }
  if (health.response?.status) {
    addFact("Current health endpoint", `The health response reports status "${health.response.status}".`);
  }
  for (const [name, value] of Object.entries(health.response?.checks ?? {}).slice(0, 12)) {
    addFact("Health dependency check", `The health response reports ${name}: "${value}".`);
  }

  for (const check of (context.monitoring.recentChecks ?? []).slice(0, 8)) {
    addFact(
      "Monitoring history",
      `At ${check.checkedAt}, monitoring recorded ${check.status}` +
        `${check.httpStatus === null ? "" : ` with HTTP ${check.httpStatus}`}` +
        `${check.failureReason ? ` (${check.failureReason})` : ""}.`,
    );
  }

  const release = context.currentDeployment.release;
  if (context.currentDeployment.available && release) {
    addFact(
      "Current deployment endpoint",
      `The current release is ${release.releaseId ?? "unknown"}` +
        `${release.version === null ? "" : ` (version ${release.version})`}.`,
    );
  }

  for (const event of (context.timeline ?? []).slice(-8)) {
    if (event.eventType && event.timestamp) {
      addFact(
        "Incident timeline",
        `The stored timeline records "${event.eventType}" at ${event.timestamp}` +
          `${event.author ? ` by ${event.author}` : ""}.`,
      );
    }
  }

  const remainingEvidenceSlots = Math.max(0, 40 - verifiedEvidence.length);
  const modelEvidence = diagnosis.evidence
    .slice(0, remainingEvidenceSlots)
    .map((item) => ({
      source: "AI-generated hypothesis",
      observation: `${item.observation} (unverified; the model cited ${item.source}).`.slice(0, 1_000),
      classification: "hypothesis",
    }));

  return {
    ...diagnosis,
    evidence: [...verifiedEvidence, ...modelEvidence],
    relevantLogExcerpts: context.applicationLogs.available
      ? diagnosis.relevantLogExcerpts
      : [],
  };
}

export function createInvestigationService({
  incidentService,
  monitoringService,
  diagnosisClient,
  applicationUrl = process.env.MONITORED_APP_URL || "http://127.0.0.1:4101",
  healthTimeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 1_500),
  staleAfterMs = Math.max(120_000, Number(process.env.TRIAGE_TIMEOUT_MS ?? 60_000) * 2),
  fetchImpl = fetch,
  idFactory = randomUUID,
  logger,
}) {
  if (!incidentService) throw new Error("incidentService is required.");
  if (!monitoringService) throw new Error("monitoringService is required.");
  if (!diagnosisClient || typeof diagnosisClient.investigate !== "function") {
    throw new Error("diagnosisClient.investigate is required.");
  }
  if (!Number.isInteger(healthTimeoutMs) || healthTimeoutMs < 100 || healthTimeoutMs > 60_000) {
    throw new Error("healthTimeoutMs must be between 100 and 60000.");
  }

  const appUrl = validateApplicationUrl(applicationUrl);

  async function collectContext(incident) {
    const limitations = [
      "Application logs are unavailable: this project does not persist or expose the demo application's stdout logs.",
      "Deployment history is unavailable: the demo application exposes only its current release, not a deployment history.",
    ];
    const [monitoringResult, healthResult, versionResult, timelineResult] = await Promise.allSettled([
      monitoringService.getMonitoringStatus(incident.applicationId, incident.applicationName),
      fetchEndpoint(new URL("/health", appUrl), { timeoutMs: healthTimeoutMs, fetchImpl }),
      fetchEndpoint(new URL("/version", appUrl), { timeoutMs: healthTimeoutMs, fetchImpl }),
      incidentService.getIncidentHistory(incident.incidentId),
    ]);

    const monitoring = monitoringResult.status === "fulfilled"
      ? monitoringResult.value
      : null;
    if (!monitoring) {
      limitations.push("Monitoring history could not be loaded from the incident database.");
    }
    const health = healthResult.status === "fulfilled"
      ? healthResult.value
      : { available: false, httpStatus: null, body: null, limitation: "Health endpoint could not be inspected." };
    if (health.limitation) limitations.push(`Current health: ${health.limitation}`);

    const version = versionResult.status === "fulfilled"
      ? versionResult.value
      : { available: false, httpStatus: null, body: null, limitation: "Version endpoint could not be inspected." };
    if (version.limitation) limitations.push(`Current release: ${version.limitation}`);

    return {
      incident: {
        incidentId: incident.incidentId,
        title: incident.title,
        description: incident.description,
        application: {
          id: incident.applicationId,
          name: incident.applicationName,
        },
        severity: incident.severity,
        status: incident.status,
        source: incident.source,
        reporter: incident.reporter ?? null,
        detectedAt: incident.detectedAt ?? incident.detectionTimestamp,
        createdAt: incident.createdAt,
        lastObservedFailure: incident.lastObservedFailure ?? null,
        healthCheck: incident.healthCheck ?? null,
      },
      currentApplicationHealth: {
        available: health.available,
        httpStatus: health.httpStatus,
        response: safeHealthBody(health.body),
      },
      monitoring: {
        status: monitoring?.monitoring?.status ?? "unavailable",
        latestCheck: monitoring?.application?.latestCheck ?? null,
        consecutiveFailedChecks: monitoring?.application?.consecutiveFailedChecks ?? null,
        recentChecks: summarizeChecks(monitoring?.monitoring?.recentChecks),
      },
      currentDeployment: {
        available: version.available,
        httpStatus: version.httpStatus,
        release: version.body && typeof version.body === "object"
          ? {
            releaseId: version.body.releaseId ?? null,
            version: version.body.version ?? null,
            deployedAt: version.body.deployedAt ?? null,
          }
          : null,
      },
      deploymentHistory: { available: false, entries: [] },
      applicationLogs: { available: false, entries: [] },
      timeline: timelineResult.status === "fulfilled" ? timelineResult.value ?? [] : [],
      teammateReports: Array.isArray(incident.reports) ? incident.reports : [],
      limitations,
    };
  }

  async function investigate(incidentId, { requestedBy = null } = {}) {
    const attemptId = idFactory();
    const started = await incidentService.beginInvestigation(incidentId, {
      attemptId,
      startedAt: new Date().toISOString(),
      staleAfterMs,
      requestedBy,
    });
    if (!started.incident) {
      const error = new Error("Incident was not found.");
      error.code = "INCIDENT_NOT_FOUND";
      throw error;
    }
    if (!started.started) {
      const error = new Error(started.reason === "already_running"
        ? "An investigation is already running for this incident."
        : "This incident cannot be investigated in its current status.");
      error.code = started.reason === "already_running"
        ? "INVESTIGATION_IN_PROGRESS"
        : "INVESTIGATION_NOT_ALLOWED";
      error.incident = started.incident;
      throw error;
    }

    try {
      const context = await collectContext(started.incident);
      const modelDiagnosis = validateDiagnosis(await diagnosisClient.investigate(context));
      const diagnosis = mergeDiagnosisLimitations(
        groundDiagnosisEvidence(modelDiagnosis, context),
        context.limitations,
      );
      const updated = await incidentService.completeInvestigation(incidentId, {
        attemptId,
        diagnosis,
      });
      if (!updated) throw new Error("Investigation lease expired before completion.");
      logger?.info("incident_investigation_completed", {
        incidentId,
        confidence: diagnosis.confidence,
        evidenceCount: diagnosis.evidence.length,
      });
      return { incident: updated, diagnosis };
    } catch (error) {
      const cause = error instanceof Error ? error : new Error("Unknown investigation failure.");
      const failure = {
        code: typeof cause.code === "string" ? cause.code.slice(0, 80) : "INVESTIGATION_FAILED",
        message: "Investigation failed. Check OpenCode and provider availability, then retry.",
      };
      await incidentService.failInvestigation(incidentId, { attemptId, failure });
      logger?.warn("incident_investigation_failed", {
        incidentId,
        errorName: cause.name || "Error",
        errorCode: failure.code,
      });
      cause.code ??= "INVESTIGATION_FAILED";
      throw cause;
    }
  }

  return Object.freeze({ investigate, collectContext });
}
