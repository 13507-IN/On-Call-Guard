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

async function getApiJson(path, {
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 3_000,
} = {}) {
  const baseUrl = getApiBaseUrl(env);
  const endpoint = new URL(`/api/v1/${path}`, baseUrl);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("The incident API could not be reached.");
  }

  if (!response.ok) throw new Error("The incident API returned an error.");
  try {
    return await response.json();
  } catch {
    throw new Error("The incident API returned an invalid response.");
  }
}

export function getMonitoringStatus(options) {
  return getApiJson("monitoring/status", options);
}

export function getOpenIncidents(options) {
  return getApiJson("incidents?active=true&limit=50", options);
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
