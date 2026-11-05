import { createServiceApp, startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";
import { createLogger } from "@oncall/shared/logger";
import { createTriageApp } from "./app.js";
import { createOpenCodeDiagnosisProvider } from "./opencode-provider.js";

const serviceName = "triage";
const logger = createLogger(serviceName);
const provider = createOpenCodeDiagnosisProvider();
const app = createTriageApp({
  diagnosisProvider: provider,
  serviceToken: process.env.TRIAGE_SERVICE_TOKEN ?? "",
  logger,
});

startService({
  app,
  serviceName,
  port: parsePort(process.env.TRIAGE_PORT, "TRIAGE_PORT", 4103),
});
