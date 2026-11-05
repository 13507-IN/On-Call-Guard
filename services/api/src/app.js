import { createServiceApp } from "@oncall/shared/http-service";
import {
  INCIDENT_STATUSES,
  isAuthorizedBearer,
  parseMonitoringEvent,
} from "@oncall/shared/monitoring";
import { authenticateTeamReporter } from "./team-report-auth.js";

const INCIDENT_SOURCES = ["monitoring", "team_report", "manual_dashboard"];
const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseEnumQuery(value, allowed, name) {
  if (value === undefined) return null;
  if (typeof value !== "string") throw new Error(`${name} must be a single value.`);
  const values = value.split(",");
  if (
    values.length === 0 ||
    values.length > allowed.length ||
    values.some((item) => !allowed.includes(item))
  ) {
    throw new Error(`${name} contains an unsupported value.`);
  }
  return values.length === 1 ? values[0] : values;
}

function parseIncidentQuery(query) {
  const activeValue = query.active;
  if (activeValue !== undefined && !["true", "false"].includes(activeValue)) {
    throw new Error("active must be true or false.");
  }

  const rawLimit = query.limit ?? "50";
  if (typeof rawLimit !== "string") throw new Error("limit must be a single value.");
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be an integer between 1 and 100.");
  }

  let applicationId = null;
  if (query.applicationId !== undefined) {
    if (
      typeof query.applicationId !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(query.applicationId)
    ) {
      throw new Error("applicationId is invalid.");
    }
    applicationId = query.applicationId;
  }

  return {
    active: activeValue === "true",
    status: parseEnumQuery(query.status, INCIDENT_STATUSES, "status"),
    source: parseEnumQuery(query.source, INCIDENT_SOURCES, "source"),
    severity: parseEnumQuery(query.severity, INCIDENT_SEVERITIES, "severity"),
    applicationId,
    limit,
  };
}

export function createApiApp({
  monitoringService,
  incidentService,
  applicationId,
  applicationName,
  ingestToken,
  teamReporterCredentials = [],
  readinessCheck = async () => ({
    ready: true,
    checks: { process: "ok", mongodb: "ok" },
  }),
  logger,
}) {
  if (!monitoringService) throw new Error("monitoringService is required.");
  if (!incidentService) throw new Error("incidentService is required.");

  return createServiceApp({
    serviceName: "api",
    description: "REST API for monitoring state and incidents.",
    readinessCheck,
    logger,
    configureRoutes(app) {
      app.get("/api/v1", (_req, res) => {
        res.json({
          service: "api",
          product: "On-call Incident Assistant",
          stage: "monitoring",
          endpoints: [
            "GET /api/v1/monitoring/status",
            "POST /api/v1/monitoring/checks",
            "POST /api/v1/incidents/reports (team reporter bearer token required)",
            "POST /api/v1/incidents (manual dashboard; teammate bearer token required)",
            "GET /api/v1/incidents",
            "GET /api/v1/incidents/:incidentId",
            "PATCH /api/v1/incidents/:incidentId",
            "GET /api/v1/incidents/:incidentId/history",
            "POST /api/v1/incidents/:incidentId/reports",
          ],
        });
      });

      async function createAuthenticatedIncident(req, res, source) {
        const reporter = authenticateTeamReporter(
          req.get("authorization"),
          teamReporterCredentials,
        );
        if (!reporter) {
          res.setHeader("WWW-Authenticate", 'Bearer realm="incident-reporting"');
          res.status(401).json({
            error: {
              code: "UNAUTHORIZED",
              message: "A valid teammate reporting token is required.",
              requestId: req.requestId,
            },
          });
          return;
        }

        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT",
              message: "Incident data must be an object.",
              requestId: req.requestId,
            },
          });
          return;
        }

        if (
          source === "manual_dashboard" &&
          body.source !== undefined &&
          body.source !== "manual_dashboard"
        ) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT_SOURCE",
              message: "Dashboard incident source is assigned by the API.",
              requestId: req.requestId,
            },
          });
          return;
        }

        if (body.applicationId !== applicationId) {
          res.status(400).json({
            error: {
              code: "INVALID_APPLICATION",
              message: "The selected application is not registered for incident reporting.",
              requestId: req.requestId,
            },
          });
          return;
        }

        try {
          const result = await incidentService.createIncident({
            ...body,
            source,
            applicationName,
            reporter,
          });
          res.status(result.created ? 201 : 200).json({ incident: result.incident });
        } catch (error) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT",
              message: error.message,
              requestId: req.requestId,
            },
          });
        }
      }

      app.get("/api/v1/monitoring/status", async (_req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(await monitoringService.getMonitoringStatus(applicationId, applicationName));
      });

      app.post("/api/v1/monitoring/checks", async (req, res) => {
        if (!isAuthorizedBearer(req.get("authorization"), ingestToken)) {
          res.status(401).json({
            error: {
              code: "UNAUTHORIZED",
              message: "Valid monitor authentication is required.",
              requestId: req.requestId,
            },
          });
          return;
        }

        let event;
        try {
          event = parseMonitoringEvent(req.body);
        } catch {
          res.status(400).json({
            error: {
              code: "INVALID_MONITORING_EVENT",
              message: "Monitoring event is invalid.",
              requestId: req.requestId,
            },
          });
          return;
        }

        const result = await monitoringService.recordCheck(event);
        res.status(result.duplicate ? 200 : 202).json({
          accepted: true,
          duplicate: result.duplicate,
          application: {
            id: event.applicationId,
            consecutiveFailedChecks: result.state?.consecutiveFailures ?? 0,
            consecutiveSuccessfulChecks: result.state?.consecutiveSuccesses ?? 0,
          },
          incident: result.incident,
        });
      });

      app.get("/api/v1/incidents", async (req, res) => {
        let query;
        try {
          query = parseIncidentQuery(req.query);
        } catch {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT_QUERY",
              message: "Incident query parameters are invalid.",
              requestId: req.requestId,
            },
          });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        const incidents = await incidentService.listIncidents(query);
        res.json({ incidents, count: incidents.length });
      });

      app.post("/api/v1/incidents/reports", async (req, res) => {
        await createAuthenticatedIncident(req, res, "team_report");
      });

      app.post("/api/v1/incidents", async (req, res) => {
        await createAuthenticatedIncident(req, res, "manual_dashboard");
      });

      app.get("/api/v1/incidents/:incidentId/history", async (req, res) => {
        if (!UUID_PATTERN.test(req.params.incidentId)) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT_ID",
              message: "Incident ID is invalid.",
              requestId: req.requestId,
            },
          });
          return;
        }
        const events = await incidentService.getIncidentHistory(req.params.incidentId);
        if (!events) {
          res.status(404).json({
            error: {
              code: "INCIDENT_NOT_FOUND",
              message: "Incident was not found.",
              requestId: req.requestId,
            },
          });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json({ events, count: events.length });
      });

      app.post("/api/v1/incidents/:incidentId/reports", async (req, res) => {
        if (!UUID_PATTERN.test(req.params.incidentId)) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT_ID",
              message: "Incident ID is invalid.",
              requestId: req.requestId,
            },
          });
          return;
        }
        const reporter = authenticateTeamReporter(
          req.get("authorization"),
          teamReporterCredentials,
        );
        if (!reporter) {
          res.setHeader("WWW-Authenticate", 'Bearer realm="incident-reporting"');
          res.status(401).json({
            error: {
              code: "UNAUTHORIZED",
              message: "A valid teammate reporting token is required.",
              requestId: req.requestId,
            },
          });
          return;
        }
        try {
          const incident = await incidentService.linkReport(
            req.params.incidentId,
            {
              ...req.body,
              reporter,
            },
          );
          if (!incident) {
            res.status(404).json({
              error: {
                code: "INCIDENT_NOT_FOUND",
                message: "Incident was not found.",
                requestId: req.requestId,
              },
            });
            return;
          }
          res.status(201).json({ incident });
        } catch (error) {
          res.status(400).json({
            error: {
              code: "INVALID_REPORT",
              message: error.message,
              requestId: req.requestId,
            },
          });
        }
      });

      app.patch("/api/v1/incidents/:incidentId", async (req, res) => {
        if (!UUID_PATTERN.test(req.params.incidentId)) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT_ID",
              message: "Incident ID is invalid.",
              requestId: req.requestId,
            },
          });
          return;
        }
        try {
          const incident = await incidentService.updateIncident(
            req.params.incidentId,
            req.body,
          );
          if (!incident) {
            res.status(404).json({
              error: {
                code: "INCIDENT_NOT_FOUND",
                message: "Incident was not found.",
                requestId: req.requestId,
              },
            });
            return;
          }
          res.json({ incident });
        } catch (error) {
          res.status(409).json({
            error: {
              code: "INCIDENT_UPDATE_REJECTED",
              message: error.message,
              requestId: req.requestId,
            },
          });
        }
      });

      app.get("/api/v1/incidents/:incidentId", async (req, res) => {
        if (!UUID_PATTERN.test(req.params.incidentId)) {
          res.status(400).json({
            error: {
              code: "INVALID_INCIDENT_ID",
              message: "Incident ID is invalid.",
              requestId: req.requestId,
            },
          });
          return;
        }
        const incident = await incidentService.getIncident(req.params.incidentId);
        if (!incident) {
          res.status(404).json({
            error: {
              code: "INCIDENT_NOT_FOUND",
              message: "Incident was not found.",
              requestId: req.requestId,
            },
          });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json({ incident });
      });
    },
  });
}
