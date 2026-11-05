import assert from "node:assert/strict";
import test from "node:test";
import {
  getDashboardMonitoringData,
  getIncidents,
  getMonitoringStatus,
  getOpenIncidents,
  proxyIncidentApiRequest,
} from "./monitoring-data.js";

test("dashboard API client uses the configured backend and no-store requests", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: url.href, options });
    return Response.json(
      url.pathname.endsWith("/monitoring/status")
        ? { monitoring: { status: "active" } }
        : { incidents: [], count: 0 },
    );
  };

  const result = await getDashboardMonitoringData({
    env: { API_URL: "http://api:4100/" },
    fetchImpl,
  });

  assert.equal(result.monitoring.monitoring.status, "active");
  assert.deepEqual(result.incidents, []);
  assert.equal(result.monitoringAvailable, true);
  assert.equal(result.incidentsAvailable, true);
  assert.equal(result.hasError, false);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ options }) => options.cache === "no-store"));
  assert.ok(requests.some(({ url }) => url === "http://api:4100/api/v1/monitoring/status"));
});

test("dashboard API client rejects invalid backend URLs and reports partial failures", async () => {
  await assert.rejects(
    getMonitoringStatus({ env: { API_URL: "file:///etc/passwd" } }),
    /URL is invalid/,
  );

  const result = await getDashboardMonitoringData({
    env: { API_URL: "http://api:4100" },
    fetchImpl: async (url) => url.pathname.endsWith("/incidents")
      ? Response.json({ incidents: [], count: 0 })
      : new Response(null, { status: 503 }),
  });
  assert.equal(result.monitoring, null);
  assert.deepEqual(result.incidents, []);
  assert.equal(result.monitoringAvailable, false);
  assert.equal(result.incidentsAvailable, true);
  assert.equal(result.hasError, true);
});

test("dashboard data client distinguishes failed incident loading from an empty incident list", async () => {
  const result = await getDashboardMonitoringData({
    env: { API_URL: "http://api:4100" },
    fetchImpl: async (url) => url.pathname.endsWith("/incidents")
      ? new Response(null, { status: 503 })
      : Response.json({ application: { status: "unknown" }, monitoring: { status: "starting" } }),
  });

  assert.equal(result.monitoringAvailable, true);
  assert.equal(result.incidentsAvailable, false);
  assert.deepEqual(result.incidents, []);
});

test("dashboard data client treats malformed monitoring payloads as unavailable", async () => {
  const result = await getDashboardMonitoringData({
    env: { API_URL: "http://api:4100" },
    fetchImpl: async (url) => Response.json(
      url.pathname.endsWith("/incidents") ? { incidents: [], count: 0 } : null,
    ),
  });

  assert.equal(result.monitoring, null);
  assert.equal(result.monitoringAvailable, false);
  assert.equal(result.incidentsAvailable, true);
  assert.equal(result.hasError, true);
});

test("open incident client requests only active incidents", async () => {
  let requestedUrl = "";
  await getOpenIncidents({
    env: { API_URL: "http://localhost:4100" },
    fetchImpl: async (url) => {
      requestedUrl = url.href;
      return Response.json({ incidents: [], count: 0 });
    },
  });
  assert.equal(requestedUrl, "http://localhost:4100/api/v1/incidents?active=true&limit=50");
});

test("incident list client forwards filter values to the backend API", async () => {
  let requestedUrl = "";
  await getIncidents({
    filters: { status: "investigating", source: "team_report", severity: "high" },
    env: { API_URL: "http://localhost:4100" },
    fetchImpl: async (url) => {
      requestedUrl = url.href;
      return Response.json({ incidents: [], count: 0 });
    },
  });
  assert.equal(
    requestedUrl,
    "http://localhost:4100/api/v1/incidents?limit=100&status=investigating&source=team_report&severity=high",
  );
});

test("incident-report proxy forwards the bearer token without moving it into the payload or URL", async () => {
  const token = "local-team-token-change-before-sharing-0001";
  let request;
  const response = await proxyIncidentApiRequest(
    "incidents/reports",
    {
      method: "POST",
      body: {
        applicationId: "demo-app",
        title: "Checkout failed",
        description: "A teammate report.",
      },
      authorization: `Bearer ${token}`,
    },
    {
      env: { API_URL: "http://api:4100" },
      fetchImpl: async (url, options) => {
        request = { url: url.href, options };
        return Response.json(
          { incident: { incidentId: "incident-id" } },
          { status: 201 },
        );
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(request.url, "http://api:4100/api/v1/incidents/reports");
  assert.equal(request.options.headers.authorization, `Bearer ${token}`);
  assert.equal(request.options.body.includes(token), false);
});
