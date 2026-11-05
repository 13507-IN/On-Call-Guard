"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = [
  "open",
  "investigating",
  "awaiting_approval",
  "recovering",
  "resolved",
  "failed",
];
const SOURCE_OPTIONS = ["monitoring", "team_report", "manual_dashboard"];
const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];

function humanize(value) {
  if (typeof value !== "string" || value.length === 0) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function reporterLabel(incident) {
  return incident.reporter?.name ?? incident.reporter?.id ?? "—";
}

function IncidentTable({ incidents }) {
  return (
    <div className="incident-table-wrap">
      <div className="incident-list-head" aria-hidden="true">
        <span>Incident</span>
        <span>Application</span>
        <span>Severity</span>
        <span>Source · reporter</span>
        <span>Status</span>
        <span>Updated</span>
      </div>
      <ul className="incident-list-page">
        {incidents.map((incident) => (
          <li className="incident-list-page-row" key={incident.incidentId}>
            <div className="incident-list-page-identity">
              <Link href={`/incidents/${incident.incidentId}`}>
                {incident.title}
              </Link>
              <span className="incident-id">{incident.incidentId}</span>
              <span className="incident-list-created">
                Created {formatTimestamp(incident.createdAt)}
              </span>
            </div>
            <span className="incident-list-application" data-label="Application" title={incident.applicationName}>
              {incident.applicationName}
            </span>
            <span className={`incident-severity incident-severity-${incident.severity}`} data-label="Severity">
              {humanize(incident.severity)}
            </span>
            <span className="incident-list-origin" data-label="Source · reporter">
              <span>{humanize(incident.source)}</span>
              <span>{reporterLabel(incident)}</span>
            </span>
            <span className={`incident-status-text incident-status-${incident.status}`} data-label="Status">
              {humanize(incident.status)}
            </span>
            <time data-label="Updated" dateTime={incident.updatedAt}>
              {formatTimestamp(incident.updatedAt)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IncidentReportForm({ application, onCreated }) {
  const [source, setSource] = useState("manual_dashboard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitReport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setSubmitting(true);
    const formData = new FormData(form);
    const isTeamReport = source === "team_report";
    const timestamp = formData.get("messageTimestamp");

    try {
      const body = {
        source,
        applicationId: formData.get("applicationId"),
        applicationName: formData.get("applicationName"),
        title: formData.get("title"),
        description: formData.get("description"),
        severity: formData.get("severity"),
        reporter: {
          name: formData.get("reporterName"),
          ...(isTeamReport && formData.get("reporterId")
            ? { id: formData.get("reporterId") }
            : {}),
        },
        ...(isTeamReport
          ? {
            report: {
              platform: formData.get("platform"),
              originalMessage: formData.get("originalMessage"),
              channelReference: formData.get("channelReference"),
              messageTimestamp: new Date(timestamp).toISOString(),
            },
          }
          : {}),
      };
      const response = await fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "The incident could not be created.");
      }
      await onCreated(payload.incident);
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The incident could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="incident-report-disclosure">
      <summary>Report an incident</summary>
      <form className="incident-form" onSubmit={submitReport}>
        <p className="incident-form-note">
          Reporter names are entered by the person submitting this form and are not authenticated.
          This form records the report; it does not trigger recovery.
        </p>
        <div className="incident-form-grid">
          <label>
            Report type
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="manual_dashboard">Dashboard report</option>
              <option value="team_report">Simulated teammate report</option>
            </select>
          </label>
          <label>
            Severity
            <select name="severity" defaultValue="medium">
              {SEVERITY_OPTIONS.map((severity) => (
                <option key={severity} value={severity}>{humanize(severity)}</option>
              ))}
            </select>
          </label>
          <label>
            Application ID
            <input
              name="applicationId"
              required
              maxLength={64}
              defaultValue={application?.id ?? ""}
              placeholder="Application identifier"
            />
          </label>
          <label>
            Application name
            <input
              name="applicationName"
              required
              maxLength={100}
              defaultValue={application?.name ?? ""}
              placeholder="Application name"
            />
          </label>
          <label className="incident-form-wide">
            Incident title
            <input name="title" required maxLength={160} placeholder="Briefly describe the issue" />
          </label>
          <label className="incident-form-wide">
            Description
            <textarea name="description" required maxLength={4000} rows={3} />
          </label>
          <label>
            Reporter name
            <input name="reporterName" required maxLength={120} autoComplete="name" />
          </label>
          {source === "team_report" ? (
            <>
              <label>
                Reporter ID (optional)
                <input name="reporterId" maxLength={200} />
              </label>
              <label>
                Communication platform
                <select name="platform" defaultValue="slack">
                  <option value="slack">Slack (simulated)</option>
                  <option value="discord">Discord (simulated)</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Channel or conversation
                <input name="channelReference" required maxLength={300} />
              </label>
              <label className="incident-form-wide">
                Original teammate message
                <textarea name="originalMessage" required maxLength={8000} rows={3} />
              </label>
              <label>
                Message timestamp
                <input name="messageTimestamp" type="datetime-local" required />
              </label>
            </>
          ) : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="form-submit" type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create incident"}
        </button>
      </form>
    </details>
  );
}

export default function IncidentList({
  initialIncidents,
  initialError = false,
  application = null,
}) {
  const router = useRouter();
  const [incidents, setIncidents] = useState(initialIncidents);
  const [filters, setFilters] = useState({ status: "", source: "", severity: "" });
  const [error, setError] = useState(initialError ? "Incident data could not be loaded." : "");
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const latestRequest = useRef(0);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  }, [filters]);

  const refresh = useCallback(async () => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setLoading(true);
    try {
      const response = await fetch(`/api/incidents${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.incidents)) {
        throw new Error("Incident data could not be loaded.");
      }
      if (requestId !== latestRequest.current) return;
      setIncidents(payload.incidents);
      setError("");
    } catch {
      if (requestId === latestRequest.current) {
        setError("Incident data could not be refreshed.");
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [query, refresh, refreshKey]);

  async function handleCreated(incident) {
    setIncidents((current) => [incident, ...current]);
    setFilters({ status: "", source: "", severity: "" });
    router.push(`/incidents/${incident.incidentId}`);
  }

  return (
    <section className="incident-workspace" aria-label="Incident management">
      <IncidentReportForm application={application} onCreated={handleCreated} />

      <section className="incident-list-panel" aria-labelledby="incident-list-heading">
        <div className="incident-list-toolbar">
          <div>
            <h2 id="incident-list-heading">Incident history</h2>
            <p>Newest activity appears first. Up to 100 incidents are returned.</p>
          </div>
          <button
            className="refresh-button"
            type="button"
            disabled={loading}
            onClick={() => setRefreshKey((current) => current + 1)}
          >
            {loading ? "Updating…" : "Refresh"}
          </button>
        </div>

        <div className="incident-filters" aria-label="Filter incidents">
          <label>
            Status
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{humanize(status)}</option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select
              value={filters.source}
              onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
            >
              <option value="">All sources</option>
              {SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>{humanize(source)}</option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select
              value={filters.severity}
              onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value }))}
            >
              <option value="">All severities</option>
              {SEVERITY_OPTIONS.map((severity) => (
                <option key={severity} value={severity}>{humanize(severity)}</option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="incident-load-error" role="alert">{error}</p> : null}
        {incidents.length > 0 ? (
          <>
            <p className="incident-result-count" aria-live="polite">
              {incidents.length} {incidents.length === 1 ? "incident" : "incidents"}
              {loading ? " · Updating" : ""}
            </p>
            <IncidentTable incidents={incidents} />
          </>
        ) : error ? (
          <p className="incident-empty">No incident results are available right now.</p>
        ) : (
          <p className="incident-empty">
            No incidents match these filters. Automatic monitoring incidents and submitted reports
            will appear here.
          </p>
        )}
      </section>
    </section>
  );
}
