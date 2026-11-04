import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createDemoApp } from "../src/app.js";
import { createMongoReadiness } from "../src/mongo-readiness.js";
import { selectDemoRelease } from "../src/releases.js";

const healthyRelease = selectDemoRelease({
  mode: "healthy",
  mongodbUri: "mongodb://127.0.0.1:27017/oncall_demo",
});

function createLoggerSpy() {
  const entries = [];
  return {
    entries,
    logger: {
      info: (event, fields) => entries.push({ level: "info", event, fields }),
      warn: (event, fields) => entries.push({ level: "warn", event, fields }),
      error: (event, fields) => entries.push({ level: "error", event, fields }),
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

test("homepage describes the active versioned demo release", async (t) => {
  const baseUrl = await startServer(createDemoApp({
    release: healthyRelease,
    checkDatabase: async () => "ok",
  }), t);

  const response = await fetch(baseUrl);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /demo-healthy-1\.0\.0/);
  assert.match(body, /href="\/health"/);
  assert.match(body, /href="\/version"/);
});

test("version endpoint reports the active release without exposing its database URI", async (t) => {
  const baseUrl = await startServer(createDemoApp({
    release: healthyRelease,
    checkDatabase: async () => "ok",
  }), t);

  const response = await fetch(`${baseUrl}/version`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    service: "demo-app",
    release: "demo-healthy-1.0.0",
    releaseMode: "healthy",
    version: "1.0.0",
  });
  assert.equal(JSON.stringify(body).includes("mongodb://"), false);
});

test("health endpoint returns ready only when the MongoDB ping succeeds", async (t) => {
  const baseUrl = await startServer(createDemoApp({
    release: healthyRelease,
    checkDatabase: async () => "ok",
  }), t);

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.scope, "application-readiness");
  assert.deepEqual(body.checks, { process: "ok", mongodb: "ok" });
});

test("health endpoint returns 503 when MongoDB is unavailable", async (t) => {
  const baseUrl = await startServer(createDemoApp({
    release: healthyRelease,
    checkDatabase: async () => "unavailable",
  }), t);

  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "unavailable");
  assert.deepEqual(body.checks, { process: "ok", mongodb: "unavailable" });
});

test("health endpoint sanitizes unexpected readiness errors", async (t) => {
  const { entries, logger } = createLoggerSpy();
  const baseUrl = await startServer(createDemoApp({
    release: healthyRelease,
    checkDatabase: async () => {
      throw new Error("mongodb://private-user:secret@db.internal");
    },
    logger,
  }), t);

  const response = await fetch(`${baseUrl}/health`);
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.equal(text.includes("private-user"), false);
  assert.equal(text.includes("db.internal"), false);
  assert.ok(entries.some((entry) => entry.event === "health_check_failed"));
});

test("release selection rejects unknown modes and routes the broken release to an unavailable host", () => {
  assert.throws(() => selectDemoRelease({ mode: "untrusted" }), /DEMO_APP_RELEASE/);
  assert.throws(() => selectDemoRelease({ mongodbUri: "" }), /MONGODB_URI/);

  const brokenRelease = selectDemoRelease({
    mode: "broken",
    mongodbUri: "mongodb://127.0.0.1:27017/oncall_demo",
  });

  assert.equal(brokenRelease.releaseId, "demo-broken-1.1.0");
  assert.equal(brokenRelease.version, "1.1.0");
  assert.match(brokenRelease.mongodbUri, /mongodb-unavailable\.invalid/);
});

test("MongoDB readiness performs a real driver ping and sanitizes connection failures", async () => {
  const { entries, logger } = createLoggerSpy();
  const readiness = createMongoReadiness({
    uri: "mongodb://127.0.0.1:1/oncall_demo?directConnection=true",
    logger,
    serverSelectionTimeoutMS: 200,
  });

  try {
    assert.equal(await readiness.check(), "unavailable");
    assert.ok(entries.some((entry) => entry.event === "mongodb_readiness_failed"));
    assert.equal(JSON.stringify(entries).includes("mongodb://"), false);
  } finally {
    await readiness.close();
  }
});

test("broken release returns a real readiness failure but keeps its version endpoint available", async (t) => {
  const brokenRelease = selectDemoRelease({
    mode: "broken",
    mongodbUri: "mongodb://127.0.0.1:27017/oncall_demo",
  });
  const { logger } = createLoggerSpy();
  const database = createMongoReadiness({
    uri: brokenRelease.mongodbUri,
    logger,
    serverSelectionTimeoutMS: 250,
  });
  const app = createDemoApp({
    release: brokenRelease,
    checkDatabase: database.check,
    logger,
  });
  const baseUrl = await startServer(app, t);
  t.after(() => database.close());

  const versionResponse = await fetch(`${baseUrl}/version`);
  const version = await versionResponse.json();
  const healthResponse = await fetch(`${baseUrl}/health`);
  const health = await healthResponse.json();

  assert.equal(versionResponse.status, 200);
  assert.equal(version.release, "demo-broken-1.1.0");
  assert.equal(healthResponse.status, 503);
  assert.equal(health.checks.mongodb, "unavailable");
});
