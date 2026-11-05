import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const HEALTH_VALUES = new Set(["ok", "unavailable", "unknown"]);

function sanitizeChecks(checks) {
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) return {};
  return Object.fromEntries(
    Object.entries(checks)
      .filter(([key, value]) =>
        /^[a-zA-Z0-9_-]{1,32}$/.test(key) && typeof value === "string")
      .slice(0, 12)
      .map(([key, value]) => [key, HEALTH_VALUES.has(value) ? value : "unknown"]),
  );
}

export async function probeApplication(
  config,
  {
    fetchImpl = fetch,
    idFactory = randomUUID,
    clock = () => new Date(),
  } = {},
) {
  const checkedAt = clock().toISOString();
  const startedAt = performance.now();
  let response;
  let body = null;

  try {
    response = await fetchImpl(new URL("/health", config.targetUrl), {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } catch (error) {
    return {
      checkId: idFactory(),
      checkedAt,
      status: "unavailable",
      httpStatus: null,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      failureReason: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "timeout"
        : "network_error",
      checks: {},
    };
  }

  const healthy =
    response.ok &&
    body?.status === "ok" &&
    body?.service === config.expectedService;
  const failureReason = healthy
    ? null
    : !response.ok
      ? "http_status"
      : "invalid_health_response";

  return {
    checkId: idFactory(),
    checkedAt,
    status: healthy ? "healthy" : "unavailable",
    httpStatus: response.status,
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    failureReason,
    checks: sanitizeChecks(body?.checks),
  };
}

export async function submitMonitoringCheck(event, {
  apiUrl,
  ingestToken,
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  const endpoint = new URL("/api/v1/monitoring/checks", apiUrl);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${ingestToken}`,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Monitoring API returned HTTP ${response.status}.`);
  }
  return response.json();
}

export function createMonitorEngine({
  config,
  logger,
  fetchImpl = fetch,
  probe = (settings) => probeApplication(settings, { fetchImpl }),
  submitCheck = (event) => submitMonitoringCheck(event, {
    apiUrl: config.apiUrl,
    ingestToken: config.ingestToken,
    fetchImpl,
    timeoutMs: config.timeoutMs,
  }),
}) {
  let running = false;
  let inFlight = null;
  let timer = null;
  let latestCheck = null;
  let lastSubmissionStatus = "pending";

  async function runOnce() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let check;
      try {
        check = await probe(config);
      } catch (error) {
        lastSubmissionStatus = "failed";
        logger.error("monitoring_cycle_failed", {
          applicationId: config.applicationId,
          errorName: error?.name || "Error",
        });
        return { check: null, submissionStatus: lastSubmissionStatus };
      }
      latestCheck = check;
      try {
        await submitCheck({
          applicationId: config.applicationId,
          applicationName: config.applicationName,
          check,
        });
        lastSubmissionStatus = "ok";
        logger.info("monitoring_check_recorded", {
          applicationId: config.applicationId,
          checkId: check.checkId,
          status: check.status,
          httpStatus: check.httpStatus,
          latencyMs: check.latencyMs,
        });
      } catch (error) {
        lastSubmissionStatus = "failed";
        logger.error("monitoring_check_submission_failed", {
          applicationId: config.applicationId,
          checkId: check.checkId,
          errorName: error?.name || "Error",
        });
      }
      return { check, submissionStatus: lastSubmissionStatus };
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  function scheduleNext() {
    if (!running) return;
    timer = setTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, config.intervalMs);
    timer.unref?.();
  }

  function start() {
    if (running) return;
    running = true;
    void runOnce().finally(scheduleNext);
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function getStatus() {
    return {
      running,
      applicationId: config.applicationId,
      applicationName: config.applicationName,
      intervalMs: config.intervalMs,
      timeoutMs: config.timeoutMs,
      failureThreshold: config.failureThreshold,
      recoveryThreshold: config.recoveryThreshold,
      lastSubmissionStatus,
      latestCheck,
    };
  }

  return Object.freeze({ start, stop, runOnce, getStatus });
}
