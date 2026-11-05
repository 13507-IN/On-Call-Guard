const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const INCIDENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value, field, maximum) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length === 0 || text.length > maximum) {
    throw new Error(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return text;
}

function validateBaseUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute URL.`);
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error(`${field} must use HTTPS except for local development.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${field} must not include credentials, a query, or a fragment.`);
  }
  return url.toString().replace(/\/+$/, "");
}

function apiError(status, code) {
  const error = new Error(
    status === 401
      ? "The incident API rejected its configured integration credential."
      : status === 403
        ? "The integration credential is not authorized for this action."
        : status === 404
          ? "The requested application or incident was not found."
          : status === 409
            ? "The incident cannot be changed in its current state."
            : status === 429
              ? "The incident API is rate limiting requests."
              : status >= 500
                ? "The incident API is temporarily unavailable."
                : "The incident API rejected the request.",
  );
  error.code = code || `API_HTTP_${status}`;
  error.status = status;
  return error;
}

export function createOncallApiClient({
  baseUrl,
  token,
  dashboardBaseUrl = "",
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!baseUrl) throw new Error("ONCALL_API_BASE_URL is required.");
  if (!token) throw new Error("ONCALL_API_TOKEN is required.");
  const normalizedBaseUrl = validateBaseUrl(baseUrl, "ONCALL_API_BASE_URL");
  const normalizedDashboardUrl = dashboardBaseUrl
    ? validateBaseUrl(dashboardBaseUrl, "ONCALL_DASHBOARD_BASE_URL")
    : null;

  async function request(path, { method = "GET", body } = {}) {
    let response;
    try {
      response = await fetchImpl(new URL(path.replace(/^\/+/, ""), `${normalizedBaseUrl}/`), {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const unavailable = new Error(
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "The incident API request timed out."
          : "The incident API could not be reached.",
      );
      unavailable.code = error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "API_TIMEOUT"
        : "API_UNAVAILABLE";
      throw unavailable;
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      const error = new Error("The incident API response exceeded the allowed size.");
      error.code = "API_RESPONSE_TOO_LARGE";
      throw error;
    }

    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        const error = new Error("The incident API returned an invalid response.");
        error.code = "API_INVALID_RESPONSE";
        throw error;
      }
    }
    if (!response.ok) {
      throw apiError(response.status, payload?.error?.code);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      const error = new Error("The incident API returned an invalid response.");
      error.code = "API_INVALID_RESPONSE";
      throw error;
    }
    return payload;
  }

  function incidentDashboardUrl(incidentId) {
    if (!normalizedDashboardUrl) return null;
    const url = new URL(normalizedDashboardUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/incidents/${encodeURIComponent(incidentId)}`;
    return url.toString();
  }

  return Object.freeze({
    async getMonitoringStatus() {
      return request("api/v1/monitoring/status");
    },
    async listIncidents({ active, status, source, applicationId, limit } = {}) {
      const query = new URLSearchParams();
      if (typeof active === "boolean") query.set("active", String(active));
      if (status) query.set("status", status);
      if (source) query.set("source", source);
      if (applicationId) query.set("applicationId", applicationId);
      if (limit) query.set("limit", String(limit));
      const suffix = query.size > 0 ? `?${query}` : "";
      return request(`api/v1/incidents${suffix}`);
    },
    async getIncident(incidentId) {
      const id = requiredText(incidentId, "incidentId", 64);
      if (!INCIDENT_ID_PATTERN.test(id)) throw new Error("incidentId is invalid.");
      const payload = await request(`api/v1/incidents/${encodeURIComponent(id)}`);
      return {
        ...payload,
        dashboardUrl: incidentDashboardUrl(id),
      };
    },
    async createIncidentReport({
      applicationId,
      title,
      description,
      severity = "medium",
      platform,
      originalMessage,
      eventId,
      reporterId,
      reporterName,
      channelReference,
      messageTimestamp,
    }) {
      if (!["discord", "telegram"].includes(platform)) {
        throw new Error("platform must be Discord or Telegram.");
      }
      const payload = {
        applicationId: requiredText(applicationId, "applicationId", 64),
        title: requiredText(title, "title", 160),
        description: requiredText(description, "description", 4_000),
        severity,
        report: {
          platform,
          eventId: requiredText(eventId, "eventId", 256),
          originalMessage: requiredText(originalMessage, "originalMessage", 8_000),
          ...(reporterId || reporterName
            ? {
              reporter: {
                ...(reporterId ? { id: requiredText(reporterId, "reporterId", 200) } : {}),
                ...(reporterName ? { name: requiredText(reporterName, "reporterName", 120) } : {}),
              },
            }
            : {}),
          ...(channelReference
            ? { channelReference: requiredText(channelReference, "channelReference", 300) }
            : {}),
          ...(messageTimestamp ? { messageTimestamp } : {}),
        },
      };
      const response = await request("api/v1/incidents/reports", {
        method: "POST",
        body: payload,
      });
      if (!response.incident?.incidentId) {
        const error = new Error("The incident API did not return the created incident.");
        error.code = "API_INVALID_RESPONSE";
        throw error;
      }
      return {
        incident: response.incident,
        duplicate: response.duplicate === true,
        dashboardUrl: incidentDashboardUrl(response.incident.incidentId),
      };
    },
    async investigateIncident(incidentId) {
      const id = requiredText(incidentId, "incidentId", 64);
      if (!INCIDENT_ID_PATTERN.test(id)) throw new Error("incidentId is invalid.");
      const response = await request(
        `api/v1/incidents/${encodeURIComponent(id)}/investigations`,
        { method: "POST", body: {} },
      );
      if (!response.incident?.incidentId) {
        const error = new Error("The incident API did not return the investigation state.");
        error.code = "API_INVALID_RESPONSE";
        throw error;
      }
      return {
        incident: response.incident,
        dashboardUrl: incidentDashboardUrl(id),
      };
    },
    async getInvestigation(incidentId) {
      const id = requiredText(incidentId, "incidentId", 64);
      if (!INCIDENT_ID_PATTERN.test(id)) throw new Error("incidentId is invalid.");
      const response = await request(
        `api/v1/incidents/${encodeURIComponent(id)}/investigation`,
      );
      return {
        investigation: response.investigation ?? null,
        incidentId: id,
        dashboardUrl: incidentDashboardUrl(id),
      };
    },
  });
}
