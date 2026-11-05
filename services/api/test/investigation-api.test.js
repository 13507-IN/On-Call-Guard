import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApiApp } from "../src/app.js";
import { parseTeamReporterCredentials } from "../src/team-report-auth.js";

const incidentId = "f94462bd-1b3d-4df6-a2a4-9bbd5f1c702a";
const teamToken = "investigation-test-token-at-least-32-chars-long";
const credentials = parseTeamReporterCredentials(JSON.stringify({
  [teamToken]: { id: "teammate-9", name: "Morgan" },
}));

async function startServer(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function makeApp(investigate = async () => ({
  incident: {
    incidentId,
    status: "investigating",
    investigation: { status: "completed" },
  },
})) {
  const calls = [];
  return {
    calls,
    app: createApiApp({
      monitoringService: {
        getMonitoringStatus: async () => ({}),
        recordCheck: async () => ({}),
        listIncidents: async () => [],
      },
      incidentService: {
        getIncident: async () => ({ incidentId }),
        getIncidentHistory: async () => [],
        listIncidents: async () => [],
      },
      investigationService: {
        investigate: async (...args) => {
          calls.push(args);
          return investigate(...args);
        },
      },
      applicationId: "demo-app",
      applicationName: "Demo application",
      ingestToken: "monitor-test-token-long-enough-for-tests",
      teamReporterCredentials: credentials,
    }),
  };
}

test("investigation requires a configured teammate identity and records the authenticated requester", async (t) => {
  const { app, calls } = makeApp();
  const baseUrl = await startServer(app, t);

  const unauthorized = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}/investigations`, {
    method: "POST",
  });
  assert.equal(unauthorized.status, 401);

  const accepted = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}/investigations`, {
    method: "POST",
    headers: { authorization: `Bearer ${teamToken}` },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).incident.investigation.status, "completed");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [incidentId, { requestedBy: "Morgan" }]);
});

test("investigation endpoint validates incident IDs and reports provider failure without exposing internals", async (t) => {
  const { app } = makeApp(async () => {
    const error = new Error("private provider response");
    error.code = "INVESTIGATION_FAILED";
    throw error;
  });
  const baseUrl = await startServer(app, t);
  const invalid = await fetch(`${baseUrl}/api/v1/incidents/not-a-uuid/investigations`, {
    method: "POST",
    headers: { authorization: `Bearer ${teamToken}` },
  });
  assert.equal(invalid.status, 400);

  const failed = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}/investigations`, {
    method: "POST",
    headers: { authorization: `Bearer ${teamToken}` },
  });
  assert.equal(failed.status, 502);
  const payload = await failed.json();
  assert.match(payload.error.message, /Check OpenCode/);
  assert.doesNotMatch(JSON.stringify(payload), /private provider response/);
});
