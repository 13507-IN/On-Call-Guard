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
            <strong>{report.platform ? humanize(report.platform) : "Teammate report"}</strong>
            {report.messageTimestamp ? (
              <time dateTime={report.messageTimestamp}>
                {formatTimestamp(report.messageTimestamp)}
              </time>
            ) : null}
          </div>
          <p>{report.originalMessage || "No original message was attached."}</p>
          {report.channelReference ? <span>{report.channelReference}</span> : null}
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
    const timestamp = String(data.get("messageTimestamp") ?? "").trim();
    const platform = String(data.get("platform") ?? "").trim();
    const channelReference = String(data.get("channelReference") ?? "").trim();
    const originalMessage = String(data.get("originalMessage") ?? "").trim();

    try {
      const body = {
        report: {
          ...(platform ? { platform } : {}),
          originalMessage,
          ...(channelReference ? { channelReference } : {}),
          ...(timestamp ? { messageTimestamp: new Date(timestamp).toISOString() } : {}),
        },
      };
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/reports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${String(data.get("reportingToken") ?? "").trim()}`,
        },
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
          The API resolves the reporter from this token. The original message is required to link a
          report; other communication details are optional.
        </p>
        <div className="incident-form-grid">
          <label>
            Teammate reporting token
            <input
              name="reportingToken"
              type="password"
              required
              minLength={32}
              maxLength={256}
              autoComplete="off"
              spellCheck="false"
            />
          </label>
          <label>
            Communication platform
            <select name="platform" defaultValue="">
              <option value="">Not specified</option>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Channel, message, or conversation reference (optional)
            <input name="channelReference" maxLength={300} />
          </label>
          <label className="incident-form-wide">
            Original message
            <textarea name="originalMessage" required maxLength={8000} rows={3} />
          </label>
          <label>
            Message time (optional)
            <input name="messageTimestamp" type="datetime-local" />
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
  const [investigationToken, setInvestigationToken] = useState("");
  const [investigationSubmitting, setInvestigationSubmitting] = useState(false);
  const [investigationError, setInvestigationError] = useState("");
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

  async function runInvestigation(event) {
    event.preventDefault();
    const token = investigationToken.trim();
    if (!token) {
      setInvestigationError("Enter a configured teammate token to start an investigation.");
      return;
    }
    setInvestigationSubmitting(true);
    setInvestigationError("");
    try {
      const response = await fetch(
        `/api/incidents/${encodeURIComponent(incidentId)}/investigations`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "The investigation could not be started.");
      }
      if (!payload.incident) throw new Error("The investigation response was incomplete.");
      setIncident(payload.incident);
      setSelectedStatus(payload.incident.status);
      await refresh();
    } catch (cause) {
      setInvestigationError(
        cause instanceof Error ? cause.message : "The investigation could not be completed.",
      );
      await refresh();
    } finally {
      setInvestigationSubmitting(false);
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
        Incident reports and linked teammate messages use API-mapped reporting tokens for reporter
        identity. Dashboard status changes remain unauthenticated in this MVP.
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
          <div className="investigation-heading">
            <div>
              <h3>AI investigation</h3>
              <p>
                {incident.investigation?.status === "running"
                  ? "Collecting available evidence and preparing a diagnosis."
                  : incident.investigation?.status === "failed"
                    ? incident.investigation.error?.message ?? "The last investigation failed."
                    : incident.investigation?.diagnosis?.summary ??
                      incident.investigationSummary ??
                      "No investigation findings have been recorded."}
              </p>
            </div>
            <span className={`investigation-state investigation-state-${incident.investigation?.status ?? "idle"}`}>
              {humanize(incident.investigation?.status ?? "not started")}
            </span>
          </div>

          {incident.investigation?.diagnosis ? (
            <div className="diagnosis-content">
              <div className="diagnosis-cause">
                <h4>Probable cause</h4>
                <p>{incident.investigation.diagnosis.probableCause}</p>
                <span>
                  Confidence {Math.round(incident.investigation.diagnosis.confidence * 100)}%
                  {" · "}hypothesis, not a verified root cause
                </span>
              </div>

              <div className="diagnosis-section">
                <h4>Evidence</h4>
                {incident.investigation.diagnosis.evidence.length > 0 ? (
                  <ul className="diagnosis-evidence-list">
                    {incident.investigation.diagnosis.evidence.map((item, index) => (
                      <li key={`${item.source}-${index}`}>
                        <span className={`evidence-classification evidence-${item.classification}`}>
                          {item.classification === "confirmed_fact" ? "Fact" : "Hypothesis"}
                        </span>
                        <strong>{item.source}</strong>
                        <p>{item.observation}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="incident-detail-empty">
                    No supporting evidence was available; treat the proposed cause with caution.
                  </p>
                )}
              </div>

              {incident.investigation.diagnosis.relevantLogExcerpts.length > 0 ? (
                <div className="diagnosis-section">
                  <h4>Relevant log excerpts</h4>
                  <ul className="diagnosis-plain-list">
                    {incident.investigation.diagnosis.relevantLogExcerpts.map((excerpt, index) => (
                      <li key={`${index}-${excerpt.slice(0, 24)}`}>{excerpt}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="diagnosis-section">
                <h4>Recommended investigation steps</h4>
                <ol className="diagnosis-plain-list">
                  {incident.investigation.diagnosis.recommendedInvestigationSteps.map((step, index) => (
                    <li key={`${index}-${step.slice(0, 24)}`}>{step}</li>
                  ))}
                </ol>
              </div>

              <div className="diagnosis-action">
                <h4>Recommended action · human approval required</h4>
                <p>{incident.investigation.diagnosis.recommendedAction}</p>
                <p className="investigation-risk">
                  Risk: {incident.investigation.diagnosis.risk}
                </p>
              </div>

              {incident.investigation.diagnosis.missingInformation.length > 0 ? (
                <div className="diagnosis-section">
                  <h4>Unavailable or missing information</h4>
                  <ul className="diagnosis-plain-list">
                    {incident.investigation.diagnosis.missingInformation.map((item, index) => (
                      <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          <form className="incident-investigation-form" onSubmit={runInvestigation}>
            <label htmlFor="investigation-token">Teammate access token</label>
            <input
              id="investigation-token"
              type="password"
              autoComplete="off"
              spellCheck="false"
              value={investigationToken}
              onChange={(event) => setInvestigationToken(event.target.value)}
              aria-describedby="investigation-token-help"
              required
            />
            <p id="investigation-token-help">
              Uses the same configured team token as incident reporting. It is sent only with this
              request and is not stored by the dashboard.
            </p>
            <button
              className="form-submit"
              type="submit"
              disabled={
                investigationSubmitting ||
                incident.investigation?.status === "running" ||
                incident.status === "resolved"
              }
            >
              {investigationSubmitting
                ? "Investigating…"
                : incident.investigation?.status === "failed"
                  ? "Retry investigation"
                  : incident.investigation?.status === "completed"
                    ? "Investigate again"
                    : "Start investigation"}
            </button>
            {incident.status === "resolved" ? (
              <p className="investigation-form-note">Resolved incidents are read-only.</p>
            ) : null}
            {investigationError ? (
              <p className="form-error" role="alert">{investigationError}</p>
            ) : null}
          </form>
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
