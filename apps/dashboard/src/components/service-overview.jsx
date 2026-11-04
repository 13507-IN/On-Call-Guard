"use client";

import { useCallback, useState } from "react";

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function HealthMark({ status }) {
  const label = status === "healthy" ? "Healthy" : status === "unavailable" ? "Unavailable" : "Checking";
  return (
    <span className={`health-state health-state-${status}`}>
      <span className="health-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function ServiceRow({ service, pending }) {
  const status = pending ? "checking" : service?.status ?? "checking";
  const latency = service?.latencyMs;

  return (
    <li className="service-row">
      <div className="service-identity">
        <span className="service-name">{service?.name}</span>
        <span className="service-purpose">{service?.purpose}</span>
      </div>
      <div className="service-result">
        <HealthMark status={status} />
        <span className="service-detail">
          {pending ? "Requesting /health" : service?.detail ?? "Waiting for first check"}
        </span>
      </div>
      <div className="service-latency">
        <span className="column-label">Response</span>
        <span className="numeric-value">
          {pending || latency === null || latency === undefined ? "—" : `${latency} ms`}
        </span>
      </div>
    </li>
  );
}

export default function ServiceOverview({ services, initialReport }) {
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/services", { cache: "no-store" });
      if (!response.ok) throw new Error("The dashboard could not reach its health-check route.");
      const result = await response.json();
      if (!Array.isArray(result.services)) throw new Error("The health-check response was invalid.");
      setReport(result);
    } catch (requestError) {
      setError(requestError.message || "Service health is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  const healthyCount = report?.services?.filter((service) => service.status === "healthy").length;

  return (
    <section className="health-panel" aria-labelledby="services-heading">
      <div className="panel-heading">
        <div>
          <h2 id="services-heading">Scaffold services</h2>
          <p>
            {report
              ? `${healthyCount} of ${report.services.length} responding`
              : "Five independent service endpoints"}
          </p>
        </div>
        <div className="panel-actions">
          <span className="freshness">
            {loading ? "Refreshing now" : `Checked ${formatTimestamp(report?.checkedAt)}`}
          </span>
          <button className="refresh-button" onClick={refresh} disabled={loading} type="button">
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="service-table-head" aria-hidden="true">
        <span>Service</span>
        <span>Process health</span>
        <span className="response-heading">Response</span>
      </div>

      <ul className="service-list" aria-live="polite" aria-busy={loading}>
        {services.map((service) => (
          <ServiceRow
            key={service.id}
            service={report?.services?.find((item) => item.id === service.id) ?? service}
            pending={!report}
          />
        ))}
      </ul>

      {error ? (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button className="retry-button" onClick={refresh} disabled={loading} type="button">
            Retry
          </button>
        </div>
      ) : null}

      {report?.services?.some((service) => service.status === "unavailable") ? (
        <p className="unavailable-note">
          An unavailable process is not an incident; incident detection is not active in this stage.
        </p>
      ) : null}
    </section>
  );
}
