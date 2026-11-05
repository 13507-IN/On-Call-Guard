"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const TRANSITIONS = {
  open: ["investigating", "failed"],
  investigating: ["open", "awaiting_approval", "recovering", "failed"],
  awaiting_approval: ["investigating", "recovering", "failed"],
  recovering: ["investigating", "failed"],
  resolved: [],
  failed: ["investigating"],
};

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
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function DetailField({ label, children }) {
  return (
    <div className="incident-detail-field">
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}

function LinkedReports({ reports = [] }) {
  if (reports.length === 0) {
    return <p className="incident-detail-empty">No teammate messages are linked to this incident.</p>;
  }
  return (
    <ul className="linked-report-list">
      {reports.map((report) => (
        <li key={report.reportId}>
          <div className="linked-report-heading">
            <strong>{humanize(report.platform)}</strong>
            <time dateTime={report.messageTimestamp}>{formatTimestamp(report.messageTimestamp)}</time>
          </div>
          <p>{report.originalMessage}</p>
          <span>{report.channelReference}</span>
        </li>
      ))}
    </ul>
  );
}

function LinkReportForm({ incidentId, onLinked }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const timestamp = data.get("messageTimestamp");

    try {
      const body = {
        reporter: {
          name: data.get("reporterName"),
          ...(data.get("reporterId") ? { id: data.get("reporterId") } : {}),
        },
        report: {
          platform: data.get("platform"),
          originalMessage: data.get("originalMessage"),
          channelReference: data.get("channelReference"),
          messageTimestamp: new Date(timestamp).toISOString(),
        },
      };
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "The teammate report could not be linked.");
      }
      form.reset();
      await onLinked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The teammate report could not be linked.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <details className="incident-report-disclosure incident-link-report">
      <summary>Link a teammate report</summary>
      <form className="incident-form" onSubmit={submit}>
        <p className="incident-form-note">
          Reporter identity is supplied by the person entering this record and is not verified.
        </p>
        <div className="incident-form-grid">
          <label>
            Reporter name
            <input name="reporterName" required maxLength={120} />
          </label>
          <label>
            Reporter ID (optional)
            <input name="reporterId" maxLength={200} />
          </label>
          <label>
            Communication platform
            <select name="platform" defaultValue="slack">
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Channel or conversation
            <input name="channelReference" required maxLength={300} />
          </label>
          <label className="incident-form-wide">
            Original message
            <textarea name="originalMessage" required maxLength={8000} rows={3} />
          </label>
          <label>
            Message timestamp
            <input name="messageTimestamp" type="datetime-local" required />
          </label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="form-submit" type="submit" disabled={submitting}>
          {submitting ? "Linking…" : "Link report"}
        </button>
      </form>
    </details>
  );
}

export default function IncidentDetail({
  incidentId,
  initialIncident,
  initialEvents,
  initialError = false,
  initialHistoryError = false,
}) {
  const [incident, setIncident] = useState(initialIncident);
  const [events, setEvents] = useState(initialEvents);
  const [loadError, setLoadError] = useState(initialError ? "Incident could not be loaded." : "");
  const [historyError, setHistoryError] = useState(initialHistoryError);
  const [refreshing, setRefreshing] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(initialIncident?.status ?? "");
  const [statusError, setStatusError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const allowedStatuses = useMemo(() => {
    if (!incident) return [];
    return TRANSITIONS[incident.status] ?? [];
  }, [incident]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [incidentResponse, historyResponse] = await Promise.all([
      fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, { cache: "no-store" }).catch(() => null),
      fetch(`/api/incidents/${encodeURIComponent(incidentId)}/history`, { cache: "no-store" }).catch(() => null),
    ]);
    let nextIncident = null;
    if (incidentResponse?.ok) {
      try {
        nextIncident = (await incidentResponse.json()).incident;
      } catch {
        setLoadError("Incident details returned an invalid response.");
      }
    } else {
      setLoadError("Incident details could not be refreshed.");
    }
    if (nextIncident) {
      setIncident(nextIncident);
      setSelectedStatus(nextIncident.status);
      setLoadError("");
    }
    if (historyResponse?.ok) {
      try {
        const result = await historyResponse.json();
        if (!Array.isArray(result.events)) throw new Error("Invalid history.");
        setEvents(result.events);
        setHistoryError(false);
      } catch {
        setHistoryError(true);
      }
    } else {
      setHistoryError(true);
    }
    setRefreshing(false);
  }, [incidentId]);

  useEffect(() => {
    if (refreshKey > 0) void refresh();
  }, [refresh, refreshKey]);

  async function updateStatus(event) {
    event.preventDefault();
    if (!selectedStatus || selectedStatus === incident?.status) return;
    setSavingStatus(true);
    setStatusError("");
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: selectedStatus }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Status update was rejected.");
      }
      setIncident(payload.incident);
      setSelectedStatus(payload.incident.status);
      await refresh();
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : "Status update was rejected.");
      setSelectedStatus(incident.status);
    } finally {
      setSavingStatus(false);
    }
  }

  if (!incident) {
    return (
      <section className="incident-detail-panel">
        <p className="incident-load-error" role="alert">
          {loadError || "Incident details are unavailable."}
        </p>
        <Link className="back-link" href="/incidents">Back to incidents</Link>
      </section>
    );
  }

  const detectionTime = incident.detectedAt ?? incident.detectionTimestamp;
  const recoveryCheck = incident.recoveryCheck ?? incident.lastRecoveryCheck ?? null;
  const reporter = incident.reporter?.name ?? incident.reporter?.id ?? "—";

  return (
    <div className="incident-detail-workspace">
      <div className="incident-detail-actions">
        <Link className="back-link" href="/incidents">← Incident history</Link>
        <button
          className="refresh-button"
          type="button"
          disabled={refreshing}
          onClick={() => setRefreshKey((current) => current + 1)}
        >
          {refreshing ? "Updating…" : "Refresh"}
        </button>
      </div>
      <p className="incident-auth-note">
        This local dashboard has no user authentication configured. Reporter names and dashboard
        status changes are not identity-verified.
      </p>

      <section className="incident-detail-panel" aria-labelledby="incident-summary-heading">
        <div className="incident-detail-panel-heading">
          <div>
            <h2 id="incident-summary-heading">Incident summary</h2>
            <p>{incident.description}</p>
          </div>
          <span className={`incident-status-text incident-status-${incident.status}`}>
            {humanize(incident.status)}
          </span>
        </div>
        <dl className="incident-detail-grid">
          <DetailField label="Incident ID"><span className="incident-id">{incident.incidentId}</span></DetailField>
          <DetailField label="Application">{incident.applicationName} ({incident.applicationId})</DetailField>
          <DetailField label="Severity">
            <span className={`incident-severity incident-severity-${incident.severity}`}>
              {humanize(incident.severity)}
            </span>
          </DetailField>
          <DetailField label="Detection source">{humanize(incident.source)}</DetailField>
          <DetailField label="Reporter">{reporter}</DetailField>
          <DetailField label="Assigned to">{incident.assignedTo}</DetailField>
          <DetailField label="Created">{formatTimestamp(incident.createdAt)}</DetailField>
          <DetailField label="Last updated">{formatTimestamp(incident.updatedAt)}</DetailField>
          <DetailField label="Detected">{formatTimestamp(detectionTime)}</DetailField>
          <DetailField label="Last observed failure">
            {formatTimestamp(incident.lastObservedFailure?.checkedAt ?? incident.lastObservedFailure?.timestamp)}
          </DetailField>
        </dl>
        <div className="incident-investigation">
          <h3>Investigation findings</h3>
          <p>{incident.investigationSummary || "No investigation findings have been recorded."}</p>
        </div>
        <form className="incident-status-form" onSubmit={updateStatus}>
          <label htmlFor="incident-status-select">Update status</label>
          <select
            id="incident-status-select"
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
          >
            <option value={incident.status}>{humanize(incident.status)} (current)</option>
            {allowedStatuses.map((status) => (
              <option key={status} value={status}>{humanize(status)}</option>
            ))}
          </select>
          <button
            className="form-submit"
            type="submit"
            disabled={savingStatus || selectedStatus === incident.status}
          >
            {savingStatus ? "Saving…" : "Save status"}
          </button>
          {statusError ? <span className="form-error" role="alert">{statusError}</span> : null}
        </form>
      </section>

      <div className="incident-detail-columns">
        <section className="incident-detail-panel" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">Recovery</h2>
          <dl className="incident-detail-grid incident-detail-grid-compact">
            <DetailField label="Recovery status">{humanize(incident.recoveryStatus)}</DetailField>
            <DetailField label="Resolved at">{formatTimestamp(incident.resolvedAt ?? incident.resolutionTimestamp)}</DetailField>
            <DetailField label="Outage duration">
              {Number.isFinite(incident.outageDurationMs)
                ? `${Math.round(incident.outageDurationMs / 1000)} seconds`
                : "—"}
            </DetailField>
            <DetailField label="Verification">
              {recoveryCheck
                ? `${humanize(recoveryCheck.status)} · ${formatTimestamp(recoveryCheck.checkedAt)}`
                : "No recovery verification recorded"}
            </DetailField>
          </dl>
        </section>

        <section className="incident-detail-panel" aria-labelledby="reports-heading">
          <h2 id="reports-heading">Teammate reports</h2>
          <LinkedReports reports={incident.reports} />
          <LinkReportForm incidentId={incidentId} onLinked={refresh} />
        </section>
      </div>

      <section className="incident-detail-panel incident-timeline-panel" aria-labelledby="timeline-heading">
        <div className="incident-detail-panel-heading">
          <div>
            <h2 id="timeline-heading">Incident history</h2>
            <p>Timestamped events recorded for this incident.</p>
          </div>
          <span>{events.length} {events.length === 1 ? "event" : "events"}</span>
        </div>
        {historyError ? (
          <p className="incident-load-error" role="alert">Incident history could not be loaded.</p>
        ) : events.length > 0 ? (
          <ol className="incident-timeline">
            {events.map((item) => (
              <li key={item.eventId}>
                <span className="timeline-marker" aria-hidden="true" />
                <div className="timeline-event">
                  <div className="timeline-event-heading">
                    <strong>{humanize(item.eventType)}</strong>
                    <time dateTime={item.timestamp}>{formatTimestamp(item.timestamp)}</time>
                  </div>
                  <p>{item.message}</p>
                  <span className="timeline-author">Recorded by {item.author}</span>
                  {item.metadata && Object.keys(item.metadata).length > 0 ? (
                    <details className="timeline-metadata">
                      <summary>Event evidence</summary>
                      <pre>{JSON.stringify(item.metadata, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="incident-detail-empty">No timeline events have been recorded.</p>
        )}
      </section>
    </div>
  );
}
