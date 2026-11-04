import { performance } from "node:perf_hooks";
import { SERVICE_CATALOG } from "./service-catalog.js";

function resolveHealthUrl(rawUrl, service) {
  try {
    const parsed = new URL(rawUrl || service.defaultUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/health`;
    parsed.search = "";
    parsed.hash = "";
    return parsed;
  } catch {
    return null;
  }
}

function timeoutFromEnvironment(rawTimeout) {
  if (rawTimeout === undefined || rawTimeout.trim() === "") return 1500;
  const timeout = Number(rawTimeout);
  return Number.isInteger(timeout) && timeout >= 100 && timeout <= 10000 ? timeout : null;
}

export async function probeService(
  service,
  { env = process.env, fetchImpl = fetch, timeoutMs = timeoutFromEnvironment(env.HEALTH_CHECK_TIMEOUT_MS) } = {},
) {
  const checkedAt = new Date().toISOString();
  if (timeoutMs === null) {
    return { ...publicService(service), status: "unavailable", detail: "Invalid timeout configuration.", latencyMs: null };
  }

  const url = resolveHealthUrl(env[service.envKey], service);
  if (!url) {
    return { ...publicService(service), status: "unavailable", detail: "Invalid health endpoint configuration.", latencyMs: null };
  }

  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    if (!response.ok) {
      return {
        ...publicService(service),
        status: "unavailable",
        detail: `Health endpoint returned HTTP ${response.status}.`,
        latencyMs,
        checkedAt,
      };
    }

    const body = await response.json();
    if (body?.status !== "ok" || body?.service !== service.expectedService) {
      return {
        ...publicService(service),
        status: "unavailable",
        detail: "Health endpoint returned an unexpected response.",
        latencyMs,
        checkedAt,
      };
    }

    return {
      ...publicService(service),
      status: "healthy",
      detail: "Process is responding; dependency checks are not configured.",
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
    return {
      ...publicService(service),
      status: "unavailable",
      detail: error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "Health endpoint timed out."
        : "Health endpoint could not be reached.",
      latencyMs,
      checkedAt,
    };
  }
}

function publicService(service) {
  return { id: service.id, name: service.name, purpose: service.purpose };
}

export async function getHealthReport(options = {}) {
  const services = await Promise.all(
    SERVICE_CATALOG.map((service) => probeService(service, options)),
  );

  return {
    checkedAt: new Date().toISOString(),
    scope: "on-demand-process-checks",
    services,
  };
}
