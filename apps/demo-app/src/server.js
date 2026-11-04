import { createLogger } from "@oncall/shared/logger";
import { startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";
import { createDemoApp } from "./app.js";
import { createMongoReadiness } from "./mongo-readiness.js";
import { selectDemoRelease } from "./releases.js";

const serviceName = "demo-app";
const logger = createLogger(serviceName);
const release = selectDemoRelease({
  mode: process.env.DEMO_APP_RELEASE,
  mongodbUri: process.env.MONGODB_URI,
});
const database = createMongoReadiness({ uri: release.mongodbUri, logger });
const app = createDemoApp({ release, checkDatabase: database.check, logger });

startService({
  app,
  serviceName,
  port: parsePort(process.env.DEMO_APP_PORT, "DEMO_APP_PORT", 4101),
  onShutdown: database.close,
});
