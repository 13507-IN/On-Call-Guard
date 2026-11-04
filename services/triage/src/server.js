import { createServiceApp, startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";

const serviceName = "triage";
const app = createServiceApp({
  serviceName,
  description: "Read-only triage service shell. AI investigation is not part of Prompt 1.",
});

startService({
  app,
  serviceName,
  port: parsePort(process.env.TRIAGE_PORT, "TRIAGE_PORT", 4103),
});
