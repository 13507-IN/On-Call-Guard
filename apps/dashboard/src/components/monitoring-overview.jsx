"use client";

import { useCallback, useEffect, useState } from "react";

function formatTimestamp(timestamp) {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function humanize(value) {
  if (typeof value !== "string" || value.length === 0) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StateMark({ status, label }) {
  let visualState = "checking";
  if (!status || status === "unknown") visualState = "unknown";
  else if (status === "healthy" || status === "active" || status === "resolved") {
    visualState = "healthy";
  } else if (status === "unavailable" || status === "stale" || status === "failed") {
    visualState = "unavailable";
  }
  return (
    <span className={`health-state health-state-${visualState}`}>
      <span className="health-dot" aria-hidden="true" />
      {label ?? humanize(status)}
    </span>
  );
}

function checkDetail(check) {
  if (!check) return "No check received yet.";
  const evidence = Object.entries(check.checks ?? {})
    .map(([name, value]) => `${humanize(name)} ${humanize(value).toLowerCase()}`)
    .join(" · ");
  if (check.failureReason === "timeout") return evidence || "Health check timed out.";
  if (check.failureReason === "network_error") return "Application endpoint could not be reached.";
  if (check.failureReason === "invalid_health_response") return "Health endpoint response was invalid.";
  if (check.status === "unavailable") {
    return [`HTTP ${check.httpStatus ?? "-"}`, evidence].filter(Boolean).join(" · ");
  }
  return evidence || "Application readiness check passed.";
}

function SummaryItem({ label, children, detail }) {
  return (
    <div className="monitor-summary-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

function IncidentRow({ incident }) {
  return (
    <li className="incident-row">
      <div className="incident-identity">
        <span className="incident-title">{incident.title}</span>
        <span className="incident-description">{incident.description}</span>
        <span className="incident-id">{incident.incidentId}</span>
      </div>
      <div className="incident-cell">
        <span className="column-label">Severity</span>
        <span className={`incident-severity incident-severity-${incident.severity}`}>
          {humanize(incident.severity)}
        </span>
      </div>
      <div className="incident-cell incident-detected">
        <span className="column-label">Detected</span>
        <time dateTime={incident.detectedAt}>{formatTimestamp(incident.detectedAt)}</time>
      </div>
      <div className="incident-cell">
        <span className="column-label">Source</span>
        <span>{incident.source}</span>
      </div>
      <div className="incident-cell">
        <span className="column-label">Status</span>
        <StateMark status={incident.status} />
      </div>
    </li>
  );
}

export default function MonitoringOverview({
  initialMonitoring,
  initialIncidents,
  initialMonitoringAvailable = Boolean(initialMonitoring),
  initialIncidentsAvailable = Array.isArray(initialIncidents),
  initialUpdatedAt = null,
  initialError = false,
}) {
  const [monitoring, setMonitoring] = useState(initialMonitoring);
  const [incidents, setIncidents] = useState(initialIncidents);
  const [monitoringAvailable, setMonitoringAvailable] = useState(initialMonitoringAvailable);
  const [incidentsAvailable, setIncidentsAvailable] = useState(initialIncidentsAvailable);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError ? "Live monitoring data is unavailable." : "");
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [monitoringResponse, incidentsResponse] = await Promise.all([
      fetch("/api/monitoring", { cache: "no-store" }).catch(() => null),
      fetch("/api/incidents", { cache: "no-store" }).catch(() => null),
    ]);

    let hasError = false;
    let hasFreshData = false;
    if (monitoringResponse?.ok) {
      try {
        const result = await monitoringResponse.json();
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw new Error("Invalid monitoring response.");
        }
        setMonitoring(result);
        setMonitoringAvailable(true);
        hasFreshData = true;
      } catch {
        hasError = true;
      }
    } else {
      hasError = true;
    }

    if (incidentsResponse?.ok) {
      try {
        const result = await incidentsResponse.json();
        if (!Array.isArray(result.incidents)) throw new Error("Invalid incident response.");
        setIncidents(result.incidents);
        setIncidentsAvailable(true);
        hasFreshData = true;
      } catch {
        hasError = true;
      }
    } else {
      hasError = true;
    }

    setError(hasError ? "Some monitoring data could not be refreshed." : "");
    if (hasFreshData) setUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const application = monitoring?.application;
  const monitor = monitoring?.monitoring;
  const latestCheck = application?.latestCheck;
  const applicationLabel = application?.status === "healthy"
    ? "Healthy"
    : application?.status === "unavailable"
      ? "Unavailable"
      : "Unknown";
  const monitorLabel = monitor?.status === "active"
    ? "Active"
    : monitor?.status === "stale"
      ? "No recent checks"
      : !monitor
        ? "Unknown"
        : monitor.status === "starting"
          ? "Starting"
          : humanize(monitor.status);
  const hasMonitoringPolicy =
    Number.isFinite(monitor?.intervalMs) && Number.isFinite(monitor?.failureThreshold);
  const policyDescription = hasMonitoringPolicy
    ? `Independent checks every ${Math.round(monitor.intervalMs / 1000)} sec; incident after ${monitor.failureThreshold} consecutive failures.`
    : "Monitoring policy is unavailable until the API responds.";
  const failureCount = application?.consecutiveFailedChecks;
  const monitorDetail = monitor?.lastCheckAt
    ? `Last check ${formatTimestamp(monitor.lastCheckAt)}`
    : monitor
      ? "Waiting for first check"
      : monitoringAvailable
        ? "No monitoring status is reported"
        : "Monitoring status unavailable";

  return (
    <section className="health-panel monitoring-panel" aria-labelledby="monitoring-heading">
      <div className="panel-heading">
        <div>
          <h2 id="monitoring-heading">Demo application monitoring</h2>
          <p>{policyDescription}</p>
        </div>
        <div className="panel-actions">
          <span className="freshness" aria-live="polite">
            {loading ? "Updating" : updatedAt ? `Updated ${formatTimestamp(updatedAt)}` : "Not available"}
          </span>
          <button className="refresh-button" onClick={refresh} disabled={loading} type="button">
            {loading ? "Updating…" : "Refresh"}
          </button>
        </div>
      </div>

      <dl className="monitor-summary-grid" aria-live="polite">
        <SummaryItem label="Application health" detail={checkDetail(latestCheck)}>
          <StateMark status={application?.status} label={applicationLabel} />
        </SummaryItem>
        <SummaryItem
          label="Monitoring service"
          detail={monitorDetail}
        >
          <StateMark status={monitor?.status ?? "unknown"} label={monitorLabel} />
        </SummaryItem>
        <SummaryItem
          label="Consecutive failures"
          detail={
            Number.isFinite(monitor?.failureThreshold)
              ? `Incident threshold: ${monitor.failureThreshold}`
              : "Failure threshold unavailable"
          }
        >
          <span className="monitor-number">
            {Number.isFinite(failureCount) ? failureCount : "—"}
            {Number.isFinite(monitor?.failureThreshold) ? (
              <span> / {monitor.failureThreshold}</span>
            ) : null}
          </span>
        </SummaryItem>
        <SummaryItem label="Last response" detail={latestCheck ? formatTimestamp(latestCheck.checkedAt) : "No response recorded"}>
          <span className="monitor-number">
            {typeof latestCheck?.latencyMs === "number" ? `${latestCheck.latencyMs} ms` : "-"}
          </span>
        </SummaryItem>
      </dl>

      {error ? (
        <div className="inline-error monitoring-error" role="alert">
          <span>{error}</span>
          <button className="retry-button" onClick={refresh} disabled={loading} type="button">
            Retry
          </button>
        </div>
      ) : null}

      <div className="incident-section">
        <div className="incident-section-heading">
          <h3>Open incidents</h3>
          <span>{incidentsAvailable ? `${incidents.length} active` : "Unavailable"}</span>
        </div>
        {!incidentsAvailable ? (
          <p className="incident-empty" aria-live="polite">
            Incident records could not be loaded. Use Refresh to try again.
          </p>
        ) : incidents.length > 0 ? (
          <>
            <div className="incident-table-head" aria-hidden="true">
              <span>Incident</span>
              <span>Severity</span>
              <span>Detected</span>
              <span>Source</span>
              <span>Status</span>
            </div>
            <ul className="incident-list" aria-live="polite" aria-busy={loading}>
              {incidents.map((incident) => (
                <IncidentRow key={incident.incidentId} incident={incident} />
              ))}
            </ul>
          </>
        ) : (
          <p className="incident-empty" aria-live="polite">
            No active incidents. The monitor will open one after the configured failure threshold.
          </p>
        )}
      </div>
    </section>
  );
}
