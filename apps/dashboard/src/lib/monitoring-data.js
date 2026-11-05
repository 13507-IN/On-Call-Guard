function getApiBaseUrl(env) {
  let url;
  try {
    url = new URL(env.API_URL || "http://127.0.0.1:4100");
  } catch {
    throw new Error("The backend API URL is invalid.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The backend API URL is invalid.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

export async function requestIncidentApi(path, {
  method = "GET",
  body,
  authorization,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 3_000,
} = {}) {
  const baseUrl = getApiBaseUrl(env);
  const endpoint = new URL(`/api/v1/${path}`, baseUrl);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(typeof authorization === "string" && authorization.length <= 512
          ? { authorization }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("The incident API could not be reached.");
  }

  try {
    return {
      status: response.status,
      payload: await response.json(),
    };
  } catch {
    throw new Error("The incident API returned an invalid response.");
  }
}

async function getApiJson(path, options) {
  const result = await requestIncidentApi(path, options);
  if (result.status < 200 || result.status >= 300) {
    throw new Error("The incident API returned an error.");
  }
  return result.payload;
}

export function getMonitoringStatus(options) {
  return getApiJson("monitoring/status", options);
}

export function getOpenIncidents(options) {
  return getApiJson("incidents?active=true&limit=50", options);
}

export function getIncidents({
  filters = {},
  ...options
} = {}) {
  const query = new URLSearchParams({ limit: "100", ...filters });
  return getApiJson(`incidents?${query.toString()}`, options);
}

export function getIncident(incidentId, options) {
  return getApiJson(`incidents/${encodeURIComponent(incidentId)}`, options);
}

export function getIncidentHistory(incidentId, options) {
  return getApiJson(
    `incidents/${encodeURIComponent(incidentId)}/history`,
    options,
  );
}

export async function proxyIncidentApiRequest(path, init = {}, options) {
  const result = await requestIncidentApi(path, {
    ...options,
    method: init.method ?? "GET",
    body: init.body,
    authorization: init.authorization,
  });
  return Response.json(result.payload, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function getDashboardMonitoringData(options) {
  const [monitoringResult, incidentsResult] = await Promise.allSettled([
    getMonitoringStatus(options),
    getOpenIncidents(options),
  ]);
  const monitoringAvailable =
    monitoringResult.status === "fulfilled" &&
    monitoringResult.value !== null &&
    typeof monitoringResult.value === "object" &&
    !Array.isArray(monitoringResult.value);
  const incidentsAvailable =
    incidentsResult.status === "fulfilled" &&
    Array.isArray(incidentsResult.value?.incidents);

  return {
    monitoring: monitoringAvailable ? monitoringResult.value : null,
    incidents: incidentsAvailable ? incidentsResult.value.incidents : [],
    monitoringAvailable,
    incidentsAvailable,
    hasError: !monitoringAvailable || !incidentsAvailable,
  };
}
