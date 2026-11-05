const DEFAULT_TRIAGE_URL = "http://127.0.0.1:4103";
const INVESTIGATION_PATH = "/api/v1/investigations";

function createClientError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("TRIAGE_URL must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("TRIAGE_URL must be an HTTP or HTTPS URL without credentials.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function createTriageClient({
  baseUrl = process.env.TRIAGE_URL || DEFAULT_TRIAGE_URL,
  serviceToken = process.env.TRIAGE_SERVICE_TOKEN || "",
  timeoutMs = Number(process.env.TRIAGE_TIMEOUT_MS ?? 60_000),
  fetchImpl = fetch,
} = {}) {
  if (typeof serviceToken !== "string") {
    throw new Error("TRIAGE_SERVICE_TOKEN must be text.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 180_000) {
    throw new Error("TRIAGE_TIMEOUT_MS must be between 1000 and 180000.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl must be a function.");
  }

  const endpoint = validateBaseUrl(baseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}${INVESTIGATION_PATH}`;

  async function investigate(context) {
    if (serviceToken.length < 24) {
      throw createClientError(
        "The internal triage service is not configured.",
        "TRIAGE_NOT_CONFIGURED",
      );
    }

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(context),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause?.name === "TimeoutError" || cause?.name === "AbortError";
      throw createClientError(
        timedOut ? "The triage request timed out." : "The triage service could not be reached.",
        timedOut ? "TRIAGE_TIMEOUT" : "TRIAGE_UNAVAILABLE",
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw createClientError(
        "The triage service returned an invalid response.",
        "INVALID_TRIAGE_RESPONSE",
      );
    }

    if (!response.ok) {
      throw createClientError(
        "The triage service could not complete the diagnosis.",
        "TRIAGE_PROVIDER_FAILED",
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        !payload.diagnosis || typeof payload.diagnosis !== "object" ||
        Array.isArray(payload.diagnosis)) {
      throw createClientError(
        "The triage service returned an incomplete diagnosis.",
        "INVALID_TRIAGE_RESPONSE",
      );
    }
    return payload.diagnosis;
  }

  return Object.freeze({ investigate });
}
