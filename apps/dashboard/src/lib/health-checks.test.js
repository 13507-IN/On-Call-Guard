import assert from "node:assert/strict";
import test from "node:test";
import { probeService } from "./health-checks.js";
import { SERVICE_CATALOG } from "./service-catalog.js";

const apiService = SERVICE_CATALOG.find((service) => service.id === "api");

test("probeService reports healthy only for the expected health response", async () => {
  const result = await probeService(apiService, {
    fetchImpl: async (url, options) => {
      assert.equal(url.href, "http://127.0.0.1:4100/health");
      assert.equal(options.cache, "no-store");
      return Response.json({ status: "ok", service: "api" });
    },
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.id, "api");
  assert.equal(typeof result.latencyMs, "number");
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("probeService marks an unexpected service response unavailable", async () => {
  const result = await probeService(apiService, {
    fetchImpl: async () => Response.json({ status: "ok", service: "other-service" }),
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.detail, "Health endpoint returned an unexpected response.");
});

test("probeService safely reports an unreachable endpoint", async () => {
  const result = await probeService(apiService, {
    fetchImpl: async () => {
      throw new TypeError("private network details are not returned to callers");
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.detail, "Health endpoint could not be reached.");
  assert.equal("url" in result, false);
});

test("probeService rejects invalid URLs and timeout settings", async () => {
  const invalidUrl = await probeService(apiService, {
    env: { API_URL: "file:///etc/passwd" },
    fetchImpl: async () => assert.fail("fetch must not run for an invalid URL"),
  });
  const invalidTimeout = await probeService(apiService, {
    env: { HEALTH_CHECK_TIMEOUT_MS: "not-a-number" },
    fetchImpl: async () => assert.fail("fetch must not run for an invalid timeout"),
  });

  assert.equal(invalidUrl.status, "unavailable");
  assert.equal(invalidUrl.detail, "Invalid health endpoint configuration.");
  assert.equal(invalidTimeout.status, "unavailable");
  assert.equal(invalidTimeout.detail, "Invalid timeout configuration.");
});
