import { createServiceApp, startService } from "@oncall/shared/http-service";
import { createLogger } from "@oncall/shared/logger";
import { parsePort } from "@oncall/shared/port";
import { readMonitorConfig } from "@oncall/shared/monitoring";
import { createMonitorEngine } from "./monitor-engine.js";

const serviceName = "monitor";
const logger = createLogger(serviceName);
const config = readMonitorConfig(process.env);
const monitor = createMonitorEngine({ config, logger });

const app = createServiceApp({
  serviceName,
  description: "Independent health monitoring for the demo application.",
  logger,
  readinessCheck: async () => {
    const status = monitor.getStatus();
    const ingestionAvailable = status.lastSubmissionStatus !== "failed";
    return {
      ready: status.running && ingestionAvailable,
      checks: {
        process: "ok",
        scheduler: status.running ? "ok" : "unavailable",
        incidentApi: ingestionAvailable ? "ok" : "unavailable",
      },
      scope: "monitoring-service",
    };
  },
  configureRoutes(service) {
    service.get("/api/v1/status", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(monitor.getStatus());
    });
  },
});

monitor.start();

startService({
  app,
  serviceName,
  port: parsePort(process.env.MONITOR_PORT, "MONITOR_PORT", 4102),
  onShutdown: async () => monitor.stop(),
});
