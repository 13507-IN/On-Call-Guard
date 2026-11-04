import { createServiceApp, startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";

const serviceName = "api";
const app = createServiceApp({
  serviceName,
  description: "The REST API shell for the On-call Incident Assistant.",
  configureRoutes(service) {
    service.get("/api/v1", (_req, res) => {
      res.json({
        service: serviceName,
        product: "On-call Incident Assistant",
        stage: "scaffold",
        message: "The API process is running. Incident endpoints are not part of Prompt 1.",
      });
    });
  },
});

startService({
  app,
  serviceName,
  port: parsePort(process.env.API_PORT, "API_PORT", 4100),
});
