import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createApiApp } from "../src/app.js";
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
    async updateIncident(incidentId, changes, { clearActiveApplicationId = false } = {}) {
      const incident = incidents.get(incidentId);
      if (!incident) return null;
      Object.assign(incident, structuredClone(changes));
      if (clearActiveApplicationId) delete incident.activeApplicationId;
      return structuredClone(incident);
    },
    async findIncident(incidentId) {
      return structuredClone(incidents.get(incidentId) ?? null);
    },
    async listIncidents({ active = false, status = null, limit = 50 } = {}) {
      return [...incidents.values()]
        .filter((incident) => !active || incident.activeApplicationId !== undefined)
        .filter((incident) => !status || (Array.isArray(status)
          ? status.includes(incident.status)
          : incident.status === status))
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
  const monitoringService = createMonitoringService({
    repository,
    policy,
    idFactory: randomUUID,
  });
  return {
    repository,
    app: createApiApp({
      monitoringService,
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
  assert.equal(resolved.incident.recoveryCheck.status, "healthy");

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
