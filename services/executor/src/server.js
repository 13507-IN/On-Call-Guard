import { createServiceApp, startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";

const serviceName = "executor";
const app = createServiceApp({
  serviceName,
  description: "Restricted recovery executor shell. Recovery actions are not part of Prompt 1.",
});

startService({
  app,
  serviceName,
  port: parsePort(process.env.EXECUTOR_PORT, "EXECUTOR_PORT", 4104),
});
