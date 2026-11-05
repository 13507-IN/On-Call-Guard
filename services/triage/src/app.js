import { isAuthorizedBearer } from "@oncall/shared/monitoring";
import { validateDiagnosis } from "@oncall/shared/diagnosis";
import { createServiceApp } from "@oncall/shared/http-service";

const INCIDENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createTriageApp({
  diagnosisProvider,
  serviceToken,
  logger,
}) {
  if (!diagnosisProvider || typeof diagnosisProvider.diagnose !== "function") {
    throw new Error("diagnosisProvider.diagnose is required.");
  }
  if (typeof serviceToken !== "string") {
    throw new Error("serviceToken must be text.");
  }

  return createServiceApp({
    serviceName: "triage",
    description: "Read-only incident diagnosis through the configured OpenCode server.",
    logger,
    configureRoutes(app) {
      app.post("/api/v1/investigations", async (req, res) => {
        if (serviceToken.length < 24) {
          res.status(503).json({
            error: { code: "SERVICE_NOT_CONFIGURED", message: "Triage service authentication is not configured." },
          });
          return;
        }
        if (!isAuthorizedBearer(req.get("authorization"), serviceToken)) {
          res.status(401).json({
            error: { code: "UNAUTHORIZED", message: "Valid API service authentication is required." },
          });
          return;
        }
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
            !req.body.incident || typeof req.body.incident !== "object" ||
            !INCIDENT_ID_PATTERN.test(req.body.incident.incidentId)) {
          res.status(400).json({
            error: { code: "INVALID_CONTEXT", message: "Investigation context is invalid." },
          });
          return;
        }

        try {
          const diagnosis = validateDiagnosis(await diagnosisProvider.diagnose(req.body));
          res.setHeader("Cache-Control", "no-store");
          res.json({ diagnosis });
        } catch (error) {
          logger?.warn("triage_provider_failed", {
            errorName: error?.name || "Error",
            requestId: req.requestId,
          });
          res.status(502).json({
            error: {
              code: "DIAGNOSIS_UNAVAILABLE",
              message: "The configured AI diagnosis provider did not return a valid diagnosis.",
              requestId: req.requestId,
            },
          });
        }
      });
    },
  });
}
