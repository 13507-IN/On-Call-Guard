import assert from "node:assert/strict";
import test from "node:test";
import { createMonitorEngine, probeApplication } from "../src/monitor-engine.js";

const config = {
  applicationId: "demo-app",
  applicationName: "Demo application",
  expectedService: "demo-app",
  targetUrl: "http://127.0.0.1:4101",
  apiUrl: "http://127.0.0.1:4100",
  intervalMs: 30_000,
  timeoutMs: 100,
  failureThreshold: 3,
  recoveryThreshold: 2,
  ingestToken: "monitor-test-secret-with-enough-length",
};

test("health probe accepts the expected ready response and records latency and evidence", async () => {
  const result = await probeApplication(config, {
    idFactory: () => "440e8400-e29b-41d4-a716-446655440000",
    clock: () => new Date("2026-11-05T08:00:00.000Z"),
    fetchImpl: async (url, options) => {
      assert.equal(url.href, "http://127.0.0.1:4101/health");
      assert.equal(options.cache, "no-store");
      return Response.json({
        status: "ok",
        service: "demo-app",
        checks: { process: "ok", mongodb: "ok" },
      });
    },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.failureReason, null);
  assert.deepEqual(result.checks, { process: "ok", mongodb: "ok" });
  assert.equal(result.checkedAt, "2026-11-05T08:00:00.000Z");
});

test("health probe records HTTP 500 as a failed check with safe dependency evidence", async () => {
  const result = await probeApplication(config, {
    fetchImpl: async () => Response.json({
      status: "unavailable",
      service: "demo-app",
      checks: { process: "ok", mongodb: "unavailable" },
    }, { status: 500 }),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.httpStatus, 500);
  assert.equal(result.failureReason, "http_status");
  assert.deepEqual(result.checks, { process: "ok", mongodb: "unavailable" });
});

test("health probe classifies timeout and network errors without leaking error details", async () => {
  const timeout = await probeApplication(config, {
    fetchImpl: async () => {
      const error = new Error("private endpoint details");
      error.name = "TimeoutError";
      throw error;
    },
  });
  const network = await probeApplication(config, {
    fetchImpl: async () => {
      throw new Error("private endpoint details");
    },
  });

  assert.equal(timeout.failureReason, "timeout");
  assert.equal(timeout.httpStatus, null);
  assert.equal(network.failureReason, "network_error");
  assert.equal(JSON.stringify(network).includes("private endpoint"), false);
});

test("health probe rejects malformed and mismatched health responses", async () => {
  const malformed = await probeApplication(config, {
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  const wrongService = await probeApplication(config, {
    fetchImpl: async () => Response.json({ status: "ok", service: "other-app" }),
  });

  assert.equal(malformed.failureReason, "invalid_health_response");
  assert.equal(wrongService.failureReason, "invalid_health_response");
  assert.equal(wrongService.status, "unavailable");
});

test("monitor submits every cycle and does not overlap an in-flight check", async () => {
  const events = [];
  const logger = {
    info() {},
    warn() {},
    error() {},
  };
  let releaseProbe;
  const monitor = createMonitorEngine({
    config,
    logger,
    probe: () => new Promise((resolve) => {
      releaseProbe = () => resolve({
        checkId: "440e8400-e29b-41d4-a716-446655440000",
        checkedAt: "2026-11-05T08:00:00.000Z",
        status: "healthy",
        httpStatus: 200,
        latencyMs: 2,
        failureReason: null,
        checks: { mongodb: "ok" },
      });
    }),
    submitCheck: async (event) => events.push(event),
  });

  const first = monitor.runOnce();
  const second = monitor.runOnce();
  releaseProbe();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.check.checkId, secondResult.check.checkId);
  assert.equal(events.length, 1);
  assert.equal(events[0].applicationId, "demo-app");
  assert.equal(monitor.getStatus().lastSubmissionStatus, "ok");
});

test("unexpected probe errors are logged and do not reject the monitoring cycle", async () => {
  const logged = [];
  const monitor = createMonitorEngine({
    config,
    logger: {
      info() {},
      warn() {},
      error(event, metadata) {
        logged.push({ event, metadata });
      },
    },
    probe: async () => {
      throw new TypeError("unexpected probe failure");
    },
    submitCheck: async () => {
      assert.fail("a check must not be submitted when probing throws");
    },
  });

  const result = await monitor.runOnce();

  assert.deepEqual(result, { check: null, submissionStatus: "failed" });
  assert.equal(monitor.getStatus().lastSubmissionStatus, "failed");
  assert.deepEqual(logged, [{
    event: "monitoring_cycle_failed",
    metadata: { applicationId: config.applicationId, errorName: "TypeError" },
  }]);
});
