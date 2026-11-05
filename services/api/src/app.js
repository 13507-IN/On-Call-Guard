import { createServiceApp } from "@oncall/shared/http-service";
import {
  INCIDENT_STATUSES,
  isAuthorizedBearer,
  parseMonitoringEvent,
} from "@oncall/shared/monitoring";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  let status = null;
  if (query.status !== undefined) {
    if (typeof query.status !== "string") throw new Error("status must be a single value.");
    status = query.status.split(",");
    if (status.length > INCIDENT_STATUSES.length || status.some((value) => !INCIDENT_STATUSES.includes(value))) {
      throw new Error("status contains an unsupported incident status.");
    }
  }

  return {
    active: activeValue === "true",
    status: status?.length === 1 ? status[0] : status,
    limit,
  };
}

export function createApiApp({
  monitoringService,
  applicationId,
  applicationName,
  ingestToken,
  readinessCheck = async () => ({
    ready: true,
    checks: { process: "ok", mongodb: "ok" },
  }),
  logger,
}) {
  if (!monitoringService) throw new Error("monitoringService is required.");

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
            "GET /api/v1/incidents",
            "GET /api/v1/incidents/:incidentId",
          ],
        });
      });

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
        const incidents = await monitoringService.listIncidents(query);
        res.json({ incidents, count: incidents.length });
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
        const incident = await monitoringService.getIncident(req.params.incidentId);
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
