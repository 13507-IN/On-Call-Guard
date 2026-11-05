import assert from "node:assert/strict";
import test from "node:test";
import { createOncallApiClient } from "../src/oncall-api-client.js";

const incidentId = "f94462bd-1b3d-4df6-a2a4-9bbd5f1c702a";
const baseUrl = "https://api.example.test";
const token = "integration-token-that-is-never-printed";

function response(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("reads the configured application and incidents through the incident API", async () => {
  const calls = [];
  const client = createOncallApiClient({
    baseUrl,
    token,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(200, String(url).includes("monitoring/status")
        ? { application: { id: "demo-app", name: "Demo application" } }
        : { incidents: [], count: 0 });
    },
  });

  const status = await client.getMonitoringStatus();
  const incidents = await client.listIncidents({ active: true, limit: 10 });
  assert.equal(status.application.id, "demo-app");
  assert.equal(incidents.count, 0);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${token}`);
  assert.match(calls[1].url, /active=true/);
  assert.match(calls[1].url, /limit=10/);
});

test("creates a platform report with source identity and original event data", async () => {
  let sentPayload;
  const client = createOncallApiClient({
    baseUrl,
    token,
    dashboardBaseUrl: "https://ops.example/",
    fetchImpl: async (_url, options) => {
      sentPayload = JSON.parse(options.body);
      return response(201, {
        duplicate: false,
        incident: { incidentId },
      });
    },
  });

  const result = await client.createIncidentReport({
    applicationId: "demo-app",
    title: "Website returns 500 errors",
    description: "The website is returning HTTP 500 errors.",
    platform: "telegram",
    originalMessage: "oncall report Website returns 500 errors",
    eventId: "room-123:message-456",
    reporterId: "telegram-user-17",
    reporterName: "Jordan",
    channelReference: "telegram-room-123",
    messageTimestamp: "2026-11-06T10:00:00.000Z",
  });

  assert.equal(sentPayload.report.platform, "telegram");
  assert.equal(sentPayload.report.eventId, "room-123:message-456");
  assert.equal(sentPayload.report.originalMessage, "oncall report Website returns 500 errors");
  assert.deepEqual(sentPayload.report.reporter, { id: "telegram-user-17", name: "Jordan" });
  assert.equal(result.dashboardUrl, `https://ops.example/incidents/${incidentId}`);
});

test("passes through duplicate-event results without creating a second response link", async () => {
  const client = createOncallApiClient({
    baseUrl,
    token,
    fetchImpl: async () => response(200, {
      duplicate: true,
      incident: { incidentId },
    }),
  });

  const result = await client.createIncidentReport({
    applicationId: "demo-app",
    title: "Website returns 500 errors",
    description: "The website is returning HTTP 500 errors.",
    platform: "discord",
    originalMessage: "oncall report Website returns 500 errors",
    eventId: "room-123:message-456",
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.dashboardUrl, null);
});

test("surfaces unauthorized, missing-application, rate-limit, and integration failures safely", async () => {
  for (const [status, expectedCode] of [
    [401, "UNAUTHORIZED"],
    [404, "INVALID_APPLICATION"],
    [429, "API_HTTP_429"],
  ]) {
    const client = createOncallApiClient({
      baseUrl,
      token,
      fetchImpl: async () => response(status, {
        error: { code: expectedCode },
      }),
    });
    await assert.rejects(
      () => client.getMonitoringStatus(),
      (error) => error.code === expectedCode,
    );
  }

  const offline = createOncallApiClient({
    baseUrl,
    token,
    fetchImpl: async () => {
      throw new TypeError("socket details should not be exposed");
    },
  });
  await assert.rejects(
    () => offline.getMonitoringStatus(),
    (error) => error.code === "API_UNAVAILABLE" && !error.message.includes("socket"),
  );
});

test("requests investigation and reads its saved diagnosis through the existing endpoints", async () => {
  const calls = [];
  const client = createOncallApiClient({
    baseUrl,
    token,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(200, calls.length === 1
        ? { incident: { incidentId, investigation: { status: "completed" } } }
        : { investigation: { status: "completed", diagnosis: { summary: "Available" } } });
    },
  });

  const investigated = await client.investigateIncident(incidentId);
  const saved = await client.getInvestigation(incidentId);
  assert.equal(investigated.incident.investigation.status, "completed");
  assert.equal(saved.investigation.diagnosis.summary, "Available");
  assert.match(calls[0].url, /investigations$/);
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[1].url, /investigation$/);
});
