import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createTriageApp } from "../src/app.js";
import { createOpenCodeDiagnosisProvider, READ_ONLY_PERMISSIONS } from "../src/opencode-provider.js";

const serviceToken = "triage-service-test-token-long-enough-for-tests";
const context = {
  incident: {
    incidentId: "f94462bd-1b3d-4df6-a2a4-9bbd5f1c702a",
    source: "team_report",
  },
  applicationLogs: { available: false, entries: [] },
  deploymentHistory: { available: false, entries: [] },
  limitations: ["Application logs are unavailable."],
};

const diagnosis = () => ({
  summary: "The app health response reports a database problem.",
  probableCause: "Database connectivity is failing.",
  evidence: [{
    source: "health response",
    observation: "MongoDB is unavailable.",
    classification: "confirmed_fact",
  }],
  relevantLogExcerpts: [],
  confidence: 0.6,
  recommendedInvestigationSteps: ["Inspect database availability."],
  recommendedAction: "Confirm the database state before taking recovery action.",
  risk: "Restarting the app may not resolve a database outage.",
  missingInformation: [],
  requiresHumanApproval: true,
});

async function startServer(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function mockClientFactory({ output = diagnosis(), onPrompt, onDelete } = {}) {
  const calls = {};
  const factory = (options) => {
    calls.clientOptions = options;
    return {
      session: {
        async create(parameters, requestOptions) {
          calls.create = { parameters, requestOptions };
          return { data: { id: "session-for-test" } };
        },
        async prompt(parameters, requestOptions) {
          calls.prompt = { parameters, requestOptions };
          onPrompt?.(parameters);
          return { data: { info: { structured: output } } };
        },
        async delete(parameters, requestOptions) {
          calls.delete = { parameters, requestOptions };
          onDelete?.(parameters);
          return { data: true };
        },
      },
    };
  };
  return { factory, calls };
}

test("OpenCode provider requests schema output in a deny-all session and deletes session data", async () => {
  const { factory, calls } = mockClientFactory();
  const provider = createOpenCodeDiagnosisProvider({
    baseUrl: "http://127.0.0.1:4096",
    clientFactory: factory,
  });
  const result = await provider.diagnose(context);

  assert.equal(result.summary, diagnosis().summary);
  assert.deepEqual(calls.create.parameters.permission, READ_ONLY_PERMISSIONS);
  assert.equal(calls.prompt.parameters.format.type, "json_schema");
  assert.equal(calls.prompt.parameters.agent, undefined);
  assert.equal(calls.prompt.parameters.system.includes("Do not invoke tools"), true);
  assert.deepEqual(calls.delete.parameters, { sessionID: "session-for-test" });
});

test("OpenCode provider applies HTTP basic auth only when configured", async () => {
  const { factory, calls } = mockClientFactory();
  const provider = createOpenCodeDiagnosisProvider({
    baseUrl: "http://127.0.0.1:4096",
    username: "opencode-user",
    password: "server-secret",
    fetchImpl: async (_input, options) => {
      calls.authorization = new Headers(options.headers).get("authorization");
      return new Response("{}");
    },
    clientFactory: factory,
  });
  await calls.clientOptions.fetch("http://127.0.0.1:4096/global/health");
  assert.equal(
    calls.authorization,
    `Basic ${Buffer.from("opencode-user:server-secret").toString("base64")}`,
  );
  assert.equal(typeof provider.diagnose, "function");
});

test("triage endpoint authenticates API calls and returns validated diagnosis", async (t) => {
  const app = createTriageApp({
    diagnosisProvider: { diagnose: async (received) => {
      assert.deepEqual(received, context);
      return diagnosis();
    } },
    serviceToken,
  });
  const baseUrl = await startServer(app, t);
  const unauthorized = await fetch(`${baseUrl}/api/v1/investigations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(context),
  });
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${baseUrl}/api/v1/investigations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${serviceToken}`,
    },
    body: JSON.stringify(context),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).diagnosis.requiresHumanApproval, true);
});

test("triage endpoint rejects invalid context, invalid model output, and provider failure", async (t) => {
  const invalidOutput = createTriageApp({
    diagnosisProvider: { diagnose: async () => ({ ...diagnosis(), confidence: 2 }) },
    serviceToken,
  });
  const baseUrl = await startServer(invalidOutput, t);
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${serviceToken}`,
  };
  const invalidContext = await fetch(`${baseUrl}/api/v1/investigations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ incident: { incidentId: "invalid" } }),
  });
  assert.equal(invalidContext.status, 400);

  const invalidDiagnosis = await fetch(`${baseUrl}/api/v1/investigations`, {
    method: "POST",
    headers,
    body: JSON.stringify(context),
  });
  assert.equal(invalidDiagnosis.status, 502);

  const failedProvider = createTriageApp({
    diagnosisProvider: { diagnose: async () => { throw new Error("provider secrets must not leak"); } },
    serviceToken,
  });
  const failedUrl = await startServer(failedProvider, t);
  const failure = await fetch(`${failedUrl}/api/v1/investigations`, {
    method: "POST",
    headers,
    body: JSON.stringify(context),
  });
  assert.equal(failure.status, 502);
  const payload = await failure.json();
  assert.doesNotMatch(JSON.stringify(payload), /provider secrets/);
});

test("triage endpoint remains unavailable rather than accepting requests without an internal token", async (t) => {
  const app = createTriageApp({
    diagnosisProvider: { diagnose: async () => diagnosis() },
    serviceToken: "",
  });
  const baseUrl = await startServer(app, t);
  const response = await fetch(`${baseUrl}/api/v1/investigations`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
    body: JSON.stringify(context),
  });
  assert.equal(response.status, 503);
});
