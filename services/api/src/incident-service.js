import { randomUUID } from "node:crypto";
import { INCIDENT_STATUSES } from "@oncall/shared/monitoring";

const INCIDENT_SOURCES = new Set(["monitoring", "team_report", "manual_dashboard"]);
const REPORT_PLATFORMS = new Set(["slack", "discord", "other"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const ACTIVE_STATUSES = new Set([
  "open",
  "investigating",
  "awaiting_approval",
  "recovering",
]);
const STATUS_TRANSITIONS = Object.freeze({
  open: new Set(["investigating", "failed"]),
  investigating: new Set(["open", "awaiting_approval", "recovering", "failed"]),
  awaiting_approval: new Set(["investigating", "recovering", "failed"]),
  recovering: new Set(["investigating", "resolved", "failed"]),
  resolved: new Set(),
  failed: new Set(["investigating"]),
});
const APPLICATION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function requiredText(value, field, maximum) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length === 0 || text.length > maximum) {
    throw new Error(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return text;
}

function optionalText(value, field, maximum) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, field, maximum);
}

function parseReporter(input, source) {
  if (source === "monitoring") return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("reporter is required.");
  }

  const name = optionalText(input.name, "reporter.name", 120);
  const id = optionalText(input.id, "reporter.id", 200);
  if (!name && !id) throw new Error("reporter.name or reporter.id is required.");
  if (source === "manual_dashboard" && !name) {
    throw new Error("reporter.name is required for dashboard reports.");
  }
  return { id, name };
}

function parseTeamReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("report is required for teammate reports.");
  }
  if (!REPORT_PLATFORMS.has(input.platform)) {
    throw new Error("report.platform must be slack, discord, or other.");
  }

  const messageTimestamp = input.messageTimestamp;
  const parsedTimestamp = typeof messageTimestamp === "string"
    ? Date.parse(messageTimestamp)
    : Number.NaN;
  if (!Number.isFinite(parsedTimestamp)) {
    throw new Error("report.messageTimestamp must be a valid timestamp.");
  }

  return {
    reportId: null,
    originalMessage: requiredText(input.originalMessage, "report.originalMessage", 8_000),
    platform: input.platform,
    channelReference: requiredText(input.channelReference, "report.channelReference", 300),
    messageTimestamp: new Date(parsedTimestamp).toISOString(),
  };
}

function makeEvent({
  incidentId,
  eventId,
  timestamp,
  author,
  eventType,
  message,
  metadata = {},
}) {
  return {
    incidentId,
    eventId,
    timestamp,
    author,
    eventType,
    message,
    metadata,
  };
}

function publicIncident(incident) {
  if (!incident) return null;
  const {
    activeApplicationId,
    lastProcessedCheckId,
    ...visibleIncident
  } = incident;
  return visibleIncident;
}

export function createIncidentService({
  repository,
  clock = () => new Date(),
  idFactory = randomUUID,
}) {
  if (!repository) throw new Error("repository is required.");

  function createEvent(incidentId, {
    author,
    eventType,
    message,
    metadata = {},
    timestamp,
  }) {
    return makeEvent({
      incidentId,
      eventId: idFactory(),
      timestamp: timestamp ?? clock().toISOString(),
      author,
      eventType,
      message,
      metadata,
    });
  }

  async function createIncident(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Incident data must be an object.");
    }

    const source = input.source;
    if (!INCIDENT_SOURCES.has(source)) throw new Error("Incident source is unsupported.");
    const applicationId = requiredText(input.applicationId, "applicationId", 64);
    if (!APPLICATION_ID_PATTERN.test(applicationId)) {
      throw new Error("applicationId is invalid.");
    }
    const applicationName = requiredText(input.applicationName, "applicationName", 100);
    const title = requiredText(input.title, "title", 160);
    const description = requiredText(input.description, "description", 4_000);
    const severity = input.severity ?? (source === "monitoring" ? "critical" : "medium");
    if (!SEVERITIES.has(severity)) throw new Error("severity is unsupported.");

    const reporter = parseReporter(input.reporter, source);
    const report = source === "team_report" ? parseTeamReport(input.report) : null;
    const now = clock().toISOString();

    if (source === "monitoring") {
      const activeIncident = await repository.getActiveIncident(applicationId);
      if (activeIncident) {
        return { incident: publicIncident(activeIncident), created: false, duplicate: true };
      }
    }

    const incidentId = idFactory();
    const reportRecord = report
      ? { ...report, reportId: idFactory() }
      : null;
    const detectionTimestamp = input.detectionTimestamp ?? input.detectedAt ?? now;
    const parsedDetection = Date.parse(detectionTimestamp);
    if (!Number.isFinite(parsedDetection)) {
      throw new Error("detectionTimestamp must be a valid timestamp.");
    }
    const detectedAt = new Date(parsedDetection).toISOString();
    const initialMessage = source === "monitoring"
      ? "Incident detected by application monitoring."
      : source === "team_report"
        ? "Incident reported by a teammate."
        : "Incident reported from the dashboard.";
    const initialEvent = createEvent(incidentId, {
      author: source === "monitoring" ? "monitor" : "system",
      eventType: "incident_created",
      message: initialMessage,
      timestamp: now,
      metadata: {
        source,
        reporter: reporter?.name ?? reporter?.id ?? null,
      },
    });

    const incident = {
      incidentId,
      applicationId,
      applicationName,
      title,
      description,
      severity,
      status: "open",
      source,
      reporter,
      reports: reportRecord ? [reportRecord] : [],
      createdAt: now,
      updatedAt: now,
      detectedAt,
      detectionTimestamp: detectedAt,
      assignedTo: null,
      investigationSummary: null,
      recoveryStatus: "not_started",
      resolvedAt: null,
      resolutionTimestamp: null,
      isActive: true,
      timeline: [initialEvent],
      ...(source === "monitoring"
        ? {
          startedAt: input.startedAt ?? detectedAt,
          lastObservedFailure: input.lastObservedFailure ?? null,
          healthCheck: input.lastObservedFailure ?? input.healthCheck ?? null,
          healthChecks: input.healthChecks ?? [],
          failureCount: input.failureCount ?? 1,
          activeApplicationId: applicationId,
          lastProcessedCheckId: input.lastProcessedCheckId ?? null,
        }
        : {}),
    };

    try {
      const created = await repository.createIncident(incident);
      return { incident: publicIncident(created), created: true, duplicate: false };
    } catch (error) {
      if (source !== "monitoring" || error?.code !== 11000) throw error;
      const racedIncident = await repository.getActiveIncident(applicationId);
      if (!racedIncident) throw error;
      return { incident: publicIncident(racedIncident), created: false, duplicate: true };
    }
  }

  async function recordEvent(incidentId, eventInput) {
    const event = createEvent(incidentId, eventInput);
    const incident = await repository.appendIncidentEvent(incidentId, event);
    return publicIncident(incident);
  }

  async function updateFromSystem(incidentId, changes, eventInput) {
    const current = await repository.findIncident(incidentId);
    if (!current) return null;
    const event = eventInput ? createEvent(incidentId, eventInput) : null;
    const becomesInactive = changes.status === "resolved" || changes.status === "failed";
    const updated = await repository.updateIncident(
      incidentId,
      {
        ...changes,
        updatedAt: clock().toISOString(),
        ...(changes.status && {
          isActive: ACTIVE_STATUSES.has(changes.status),
        }),
      },
      {
        clearActiveApplicationId: becomesInactive,
        event,
      },
    );
    return publicIncident(updated);
  }

  async function updateIncident(incidentId, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Incident update must be an object.");
    }
    const allowedKeys = new Set(["status", "assignedTo", "investigationSummary"]);
    if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
      throw new Error("Incident update contains unsupported fields.");
    }
    const current = await repository.findIncident(incidentId);
    if (!current) return null;

    const changes = {};
    if (Object.hasOwn(input, "status")) {
      if (!INCIDENT_STATUSES.includes(input.status)) {
        throw new Error("status is unsupported.");
      }
      if (
        input.status !== current.status &&
        !STATUS_TRANSITIONS[current.status]?.has(input.status)
      ) {
        throw new Error(`status cannot transition from ${current.status} to ${input.status}.`);
      }
      if (input.status === "resolved" && current.recoveryStatus !== "verified") {
        throw new Error("Incident cannot be resolved before recovery is verified.");
      }
      if (input.status !== current.status) {
        changes.status = input.status;
        changes.isActive = ACTIVE_STATUSES.has(input.status);
        if (input.status === "resolved") {
          changes.resolvedAt = clock().toISOString();
          changes.resolutionTimestamp = changes.resolvedAt;
        }
      }
    }
    if (Object.hasOwn(input, "assignedTo")) {
      changes.assignedTo = optionalText(input.assignedTo, "assignedTo", 120);
    }
    if (Object.hasOwn(input, "investigationSummary")) {
      changes.investigationSummary = optionalText(
        input.investigationSummary,
        "investigationSummary",
        4_000,
      );
    }
    if (Object.keys(changes).length === 0) return publicIncident(current);

    const event = createEvent(incidentId, {
      author: "dashboard",
      eventType: changes.status ? "status_changed" : "incident_updated",
      message: changes.status
        ? `Status changed from ${current.status} to ${changes.status}.`
        : "Incident details updated.",
      metadata: {
        previousStatus: current.status,
        status: changes.status ?? current.status,
        changedFields: Object.keys(changes).filter((field) => field !== "isActive"),
      },
    });
    const updated = await repository.updateIncident(
      incidentId,
      { ...changes, updatedAt: clock().toISOString() },
      {
        clearActiveApplicationId:
          changes.status === "resolved" || changes.status === "failed",
        event,
        expectedStatus: current.status,
      },
    );
    if (!updated) throw new Error("Incident changed before the update could be applied.");
    return publicIncident(updated);
  }

  async function linkReport(incidentId, input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Report data must be an object.");
    }
    const reporter = parseReporter(input.reporter, "team_report");
    const report = {
      ...parseTeamReport(input.report),
      reportId: idFactory(),
    };
    const current = await repository.findIncident(incidentId);
    if (!current) return null;

    const event = createEvent(incidentId, {
      author: reporter.name ?? reporter.id,
      eventType: "report_linked",
      message: `A ${report.platform} report was linked to this incident.`,
      metadata: {
        reportId: report.reportId,
        platform: report.platform,
        channelReference: report.channelReference,
        messageTimestamp: report.messageTimestamp,
      },
    });
    return publicIncident(await repository.addLinkedReport(incidentId, report, event));
  }

  async function getIncident(incidentId) {
    return publicIncident(await repository.findIncident(incidentId));
  }

  async function getIncidentHistory(incidentId) {
    const incident = await repository.findIncident(incidentId);
    if (!incident) return null;
    return [...(incident.timeline ?? [])].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp) || left.eventId.localeCompare(right.eventId));
  }

  async function listIncidents(options) {
    const incidents = await repository.listIncidents(options);
    return incidents.map(publicIncident);
  }

  return Object.freeze({
    createIncident,
    updateIncident,
    updateFromSystem,
    recordEvent,
    linkReport,
    getIncident,
    getIncidentHistory,
    listIncidents,
  });
}
