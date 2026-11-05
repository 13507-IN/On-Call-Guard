import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthorizedBearer,
  parseMonitoringEvent,
  readMonitorConfig,
  readMonitoringPolicy,
} from "../src/monitoring.js";

const checkId = "440e8400-e29b-41d4-a716-446655440000";

function validEvent(overrides = {}) {
  const { check: checkOverrides, ...eventOverrides } = overrides;
  return {
    applicationId: "demo-app",
    applicationName: "Demo application",
    check: {
      checkId,
      checkedAt: "2026-11-05T08:00:00.000Z",
      status: "unavailable",
      httpStatus: 503,
      latencyMs: 48.129,
      failureReason: "http_status",
      checks: { process: "ok", mongodb: "unavailable" },
      ...checkOverrides,
    },
    ...eventOverrides,
  };
}

test("monitor policy uses the documented defaults and accepts bounded overrides", () => {
  assert.deepEqual(readMonitoringPolicy({}), {
    intervalMs: 30_000,
    timeoutMs: 5_000,
    failureThreshold: 3,
    recoveryThreshold: 2,
  });
  assert.deepEqual(readMonitoringPolicy({
    MONITOR_INTERVAL_MS: "15000",
    MONITOR_TIMEOUT_MS: "2500",
    MONITOR_FAILURE_THRESHOLD: "4",
    MONITOR_RECOVERY_THRESHOLD: "3",
  }), {
    intervalMs: 15_000,
    timeoutMs: 2_500,
    failureThreshold: 4,
    recoveryThreshold: 3,
  });
});

test("monitor config rejects unsafe URLs, invalid limits and short ingest secrets", () => {
  assert.throws(() => readMonitoringPolicy({ MONITOR_INTERVAL_MS: "0" }), /MONITOR_INTERVAL_MS/);
  assert.throws(() => readMonitorConfig({ MONITOR_INGEST_TOKEN: "short" }), /MONITOR_INGEST_TOKEN/);
  assert.throws(() => readMonitorConfig({
    MONITOR_INGEST_TOKEN: "a-secure-enough-development-token",
    MONITORED_APP_URL: "file:///etc/passwd",
  }), /MONITORED_APP_URL/);
});

test("monitor config resolves safe defaults and configured service URLs", () => {
  const config = readMonitorConfig({
    MONITOR_INGEST_TOKEN: "a-secure-enough-development-token",
    MONITORED_APP_URL: "http://demo-app:4101/",
    API_URL: "http://api:4100/",
  });

  assert.equal(config.targetUrl, "http://demo-app:4101");
  assert.equal(config.apiUrl, "http://api:4100");
  assert.equal(config.applicationId, "demo-app");
  assert.equal(config.failureThreshold, 3);
});

test("monitor event validation normalizes timestamps and sanitizes check evidence", () => {
  const result = parseMonitoringEvent(validEvent({
    check: {
      checks: {
        process: "ok",
        mongodb: "unavailable",
        injected: "database password",
      },
    },
  }));

  assert.equal(result.check.latencyMs, 48.13);
  assert.deepEqual(result.check.checks, {
    process: "ok",
    mongodb: "unavailable",
    injected: "unknown",
  });
  assert.equal(result.applicationName, "Demo application");
});

test("monitor event validation rejects malformed or contradictory health evidence", () => {
  assert.throws(() => parseMonitoringEvent(validEvent({ check: { checkId: "bad" } })), /UUID/);
  assert.throws(() => parseMonitoringEvent(validEvent({ check: { latencyMs: -1 } })), /latencyMs/);
  assert.throws(() => parseMonitoringEvent(validEvent({ check: { status: "healthy" } })), /healthy check/);
  assert.throws(() => parseMonitoringEvent(validEvent({
    check: { checks: { "bad key": "ok" } },
  })), /invalid entry/);
});

test("monitor ingest bearer authentication rejects missing, malformed and wrong tokens", () => {
  const expected = "a-secure-enough-development-token";
  assert.equal(isAuthorizedBearer(`Bearer ${expected}`, expected), true);
  assert.equal(isAuthorizedBearer(`Bearer ${expected}x`, expected), false);
  assert.equal(isAuthorizedBearer(expected, expected), false);
  assert.equal(isAuthorizedBearer(null, expected), false);
});
