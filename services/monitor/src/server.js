import { createServiceApp, startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";

const serviceName = "monitor";
const app = createServiceApp({
  serviceName,
  description: "Monitoring service shell. Scheduled health checks are not part of Prompt 1.",
});

startService({
  app,
  serviceName,
  port: parsePort(process.env.MONITOR_PORT, "MONITOR_PORT", 4102),
});
