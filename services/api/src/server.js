import { MongoClient } from "mongodb";
import { createLogger } from "@oncall/shared/logger";
import { parsePort } from "@oncall/shared/port";
import { readMonitorConfig } from "@oncall/shared/monitoring";
import { createApiApp } from "./app.js";
import { createMongoIncidentRepository } from "./incident-repository.js";
import { createIncidentService } from "./incident-service.js";
import { createMonitoringService } from "./monitoring-service.js";
import { parseTeamReporterCredentials } from "./team-report-auth.js";
import { startService } from "@oncall/shared/http-service";

const serviceName = "api";
const logger = createLogger(serviceName);

async function startApi() {
  let client;
  try {
    const config = readMonitorConfig(process.env);
    const teamReporterCredentials = parseTeamReporterCredentials(
      process.env.TEAM_REPORTER_TOKENS,
    );
    const mongodbUri =
      process.env.MONGODB_URI ||
      "mongodb://127.0.0.1:27017/oncall_demo?directConnection=true";
    client = new MongoClient(mongodbUri, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    const database = client.db();
    const repository = createMongoIncidentRepository(database);
    await repository.initialize();
    const incidentService = createIncidentService({ repository });
    const monitoringService = createMonitoringService({
      repository,
      policy: config,
      incidentService,
    });
    const app = createApiApp({
      monitoringService,
      incidentService,
      applicationId: config.applicationId,
      applicationName: config.applicationName,
      ingestToken: config.ingestToken,
      teamReporterCredentials,
      readinessCheck: async () => {
        try {
          await database.command({ ping: 1 });
          return { ready: true, checks: { process: "ok", mongodb: "ok" } };
        } catch {
          return { ready: false, checks: { process: "ok", mongodb: "unavailable" } };
        }
      },
      logger,
    });

    startService({
      app,
      serviceName,
      port: parsePort(process.env.API_PORT, "API_PORT", 4100),
      onShutdown: () => client.close(),
    });
    logger.info("monitoring_api_ready", {
      applicationId: config.applicationId,
      failureThreshold: config.failureThreshold,
      recoveryThreshold: config.recoveryThreshold,
    });
  } catch (error) {
    logger.error("api_startup_failed", { errorName: error?.name || "Error" });
    await client?.close().catch(() => {});
    process.exitCode = 1;
  }
}

await startApi();
