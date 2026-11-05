import { timingSafeEqual } from "node:crypto";

export const INCIDENT_STATUSES = Object.freeze([
  "open",
  "investigating",
  "awaiting_approval",
  "recovering",
  "resolved",
  "failed",
]);

const FAILURE_REASONS = new Set([
  "http_status",
  "timeout",
  "network_error",
  "invalid_health_response",
]);
const HEALTH_VALUES = new Set(["ok", "unavailable", "unknown"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readInteger(env, key, fallback, minimum, maximum) {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function normalizeHttpUrl(raw, key, fallback) {
  let url;
  try {
    url = new URL(raw || fallback);
  } catch {
    throw new Error(`${key} must be a valid HTTP or HTTPS URL.`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${key} must be a valid HTTP or HTTPS URL without credentials.`);
  }

  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function readMonitoringPolicy(env = process.env) {
  return Object.freeze({
    intervalMs: readInteger(env, "MONITOR_INTERVAL_MS", 30_000, 1_000, 3_600_000),
    timeoutMs: readInteger(env, "MONITOR_TIMEOUT_MS", 5_000, 100, 60_000),
    failureThreshold: readInteger(env, "MONITOR_FAILURE_THRESHOLD", 3, 1, 100),
    recoveryThreshold: readInteger(env, "MONITOR_RECOVERY_THRESHOLD", 2, 1, 100),
  });
}

export function readMonitorConfig(env = process.env) {
  const policy = readMonitoringPolicy(env);
  const applicationId = env.MONITORED_APP_ID || "demo-app";
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(applicationId)) {
    throw new Error("MONITORED_APP_ID must be 1–64 letters, digits, underscores, or hyphens.");
  }

  const applicationName = env.MONITORED_APP_NAME || "Demo application";
  if (applicationName.length > 100 || applicationName.trim() === "") {
    throw new Error("MONITORED_APP_NAME must be between 1 and 100 characters.");
  }

  const ingestToken = env.MONITOR_INGEST_TOKEN || "";
  if (ingestToken.length < 24 || ingestToken.length > 256) {
    throw new Error("MONITOR_INGEST_TOKEN must be between 24 and 256 characters.");
  }

  return Object.freeze({
    ...policy,
    applicationId,
    applicationName: applicationName.trim(),
    expectedService: applicationId,
    targetUrl: normalizeHttpUrl(
      env.MONITORED_APP_URL,
      "MONITORED_APP_URL",
      "http://127.0.0.1:4101",
    ),
    apiUrl: normalizeHttpUrl(env.API_URL, "API_URL", "http://127.0.0.1:4100"),
    ingestToken,
  });
}

function sanitizeChecks(checks) {
  if (checks === undefined || checks === null) return {};
  if (typeof checks !== "object" || Array.isArray(checks)) {
    throw new Error("checks must be an object.");
  }

  const entries = Object.entries(checks);
  if (entries.length > 12) throw new Error("checks may contain at most 12 entries.");

  const sanitized = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(key) || typeof value !== "string") {
      throw new Error("checks contains an invalid entry.");
    }
    sanitized[key] = HEALTH_VALUES.has(value) ? value : "unknown";
  }
  return sanitized;
}

export function parseMonitoringEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Monitoring event must be an object.");
  }

  const { applicationId, applicationName, check } = input;
  if (typeof applicationId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(applicationId)) {
    throw new Error("applicationId is invalid.");
  }
  if (
    typeof applicationName !== "string" ||
    applicationName.trim() === "" ||
    applicationName.length > 100
  ) {
    throw new Error("applicationName must be between 1 and 100 characters.");
  }
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    throw new Error("check must be an object.");
  }

  if (typeof check.checkId !== "string" || !UUID_PATTERN.test(check.checkId)) {
    throw new Error("check.checkId must be a UUID.");
  }
  if (!["healthy", "unavailable"].includes(check.status)) {
    throw new Error("check.status must be healthy or unavailable.");
  }
  const checkedAt = Date.parse(check.checkedAt);
  if (typeof check.checkedAt !== "string" || !Number.isFinite(checkedAt)) {
    throw new Error("check.checkedAt must be a valid timestamp.");
  }
  if (
    typeof check.latencyMs !== "number" ||
    !Number.isFinite(check.latencyMs) ||
    check.latencyMs < 0 ||
    check.latencyMs > 600_000
  ) {
    throw new Error("check.latencyMs must be between 0 and 600000.");
  }
  if (
    check.httpStatus !== null &&
    (!Number.isInteger(check.httpStatus) || check.httpStatus < 100 || check.httpStatus > 599)
  ) {
    throw new Error("check.httpStatus must be an HTTP status code or null.");
  }
  if (
    check.status === "healthy" &&
    (check.failureReason !== null || check.httpStatus === null || check.httpStatus >= 400)
  ) {
    throw new Error("A healthy check must have a successful HTTP status and no failure reason.");
  }
  if (
    check.status === "unavailable" &&
    !FAILURE_REASONS.has(check.failureReason)
  ) {
    throw new Error("An unavailable check must include a recognized failure reason.");
  }

  return {
    applicationId,
    applicationName: applicationName.trim(),
    check: {
      checkId: check.checkId,
      checkedAt: new Date(checkedAt).toISOString(),
      status: check.status,
      httpStatus: check.httpStatus,
      latencyMs: Math.round(check.latencyMs * 100) / 100,
      failureReason: check.status === "healthy" ? null : check.failureReason,
      checks: sanitizeChecks(check.checks),
    },
  };
}

export function isAuthorizedBearer(headerValue, expectedToken) {
  if (typeof headerValue !== "string" || typeof expectedToken !== "string" || !expectedToken) {
    return false;
  }

  const match = /^Bearer ([^\s]+)$/.exec(headerValue);
  if (!match) return false;

  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
