import assert from "node:assert/strict";
import test from "node:test";
import { createTriageClient } from "../src/triage-client.js";

const serviceToken = "triage-client-test-token-long-enough-for-tests";
const diagnosis = {
  summary: "Health check reports MongoDB unavailable.",
};

test("triage client sends authenticated context and returns the diagnosis", async () => {
  let request;
  const client = createTriageClient({
    baseUrl: "http://127.0.0.1:4103/",
    serviceToken,
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return Response.json({ diagnosis });
    },
  });

  assert.deepEqual(await client.investigate({ incident: { incidentId: "incident-1" } }), diagnosis);
  assert.equal(request.url, "http://127.0.0.1:4103/api/v1/investigations");
  assert.equal(request.options.method, "POST");
  assert.equal(
    new Headers(request.options.headers).get("authorization"),
    `Bearer ${serviceToken}`,
  );
  assert.deepEqual(JSON.parse(request.options.body), { incident: { incidentId: "incident-1" } });
});

test("triage client does not make a request without an internal service token", async () => {
  let requested = false;
  const client = createTriageClient({
    serviceToken: "",
    fetchImpl: async () => {
      requested = true;
      return Response.json({});
    },
  });

  await assert.rejects(client.investigate({}), { code: "TRIAGE_NOT_CONFIGURED" });
  assert.equal(requested, false);
});

test("triage client maps provider, timeout, and malformed responses to safe errors", async () => {
  const providerFailure = createTriageClient({
    serviceToken,
    fetchImpl: async () => Response.json(
      { error: { message: "private provider details" } },
      { status: 502 },
    ),
  });
  await assert.rejects(providerFailure.investigate({}), (error) => {
    assert.equal(error.code, "TRIAGE_PROVIDER_FAILED");
    assert.doesNotMatch(error.message, /private provider details/);
    return true;
  });

  const timeout = createTriageClient({
    serviceToken,
    fetchImpl: async () => {
      const error = new Error("request timed out");
      error.name = "TimeoutError";
      throw error;
    },
  });
  await assert.rejects(timeout.investigate({}), { code: "TRIAGE_TIMEOUT" });

  const malformed = createTriageClient({
    serviceToken,
    fetchImpl: async () => Response.json({ diagnosis: "not an object" }),
  });
  await assert.rejects(malformed.investigate({}), { code: "INVALID_TRIAGE_RESPONSE" });
});

test("triage client rejects unsafe URLs and invalid timeouts", () => {
  assert.throws(
    () => createTriageClient({ baseUrl: "file:///tmp/triage" }),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => createTriageClient({ baseUrl: "http://user:password@localhost:4103" }),
    /without credentials/,
  );
  assert.throws(
    () => createTriageClient({ timeoutMs: 999 }),
    /between 1000 and 180000/,
  );
});
