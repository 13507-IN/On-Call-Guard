import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createServiceApp } from "@oncall/shared/http-service";

async function startServer(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test("health endpoint reports process-only status and request logging", async (t) => {
  const logs = [];
  const logger = {
    info: (event, fields) => logs.push({ level: "info", event, fields }),
    warn: (event, fields) => logs.push({ level: "warn", event, fields }),
    error: (event, fields) => logs.push({ level: "error", event, fields }),
  };
  const app = createServiceApp({ serviceName: "api", description: "API test", logger });
  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/i);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "api");
  assert.equal(body.scope, "process-only");
  assert.equal(body.checks.process, "ok");
  assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
  assert.equal(logs.at(-1).fields.path, "/health");
  assert.equal(logs.at(-1).fields.statusCode, 200);
});

test("unknown routes return a structured 404", async (t) => {
  const { server, baseUrl } = await startServer(
    createServiceApp({ serviceName: "api", description: "API test" }),
  );
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const response = await fetch(`${baseUrl}/missing`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.match(body.error.requestId, /^[0-9a-f-]{36}$/i);
});

test("malformed JSON receives a sanitized client error", async (t) => {
  const { server, baseUrl } = await startServer(
    createServiceApp({ serviceName: "api", description: "API test" }),
  );
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const response = await fetch(`${baseUrl}/api/v1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "BAD_REQUEST");
  assert.equal(body.error.message, "Request could not be processed.");
});
