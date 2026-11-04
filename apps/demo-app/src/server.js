import { createServiceApp, startService } from "@oncall/shared/http-service";
import { parsePort } from "@oncall/shared/port";

const serviceName = "demo-app";
const app = createServiceApp({
  serviceName,
  description: "A minimal application used to validate the project scaffold.",
  configureRoutes(service) {
    service.get("/", (_req, res) => {
      res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>On-call demo application</title>
    <style>
      body { margin: 0; padding: 3rem; background: #f6f8f9; color: #172124; font: 16px/1.5 system-ui, sans-serif; }
      main { max-width: 44rem; margin: 8vh auto; padding: 2rem; background: white; border: 1px solid #dfe5e7; border-radius: 12px; }
      h1 { margin-top: 0; font-size: clamp(1.8rem, 4vw, 2.6rem); }
      a { color: #155d6b; }
    </style>
  </head>
  <body>
    <main>
      <h1>On-call demo application</h1>
      <p>This minimal Express app is part of the Prompt 1 service scaffold.</p>
      <p>Its process health endpoint is <a href="/health"><code>/health</code></a>.</p>
      <p>Database readiness and release controls are not part of this stage.</p>
    </main>
  </body>
</html>`);
    });
  },
});

startService({
  app,
  serviceName,
  port: parsePort(process.env.DEMO_APP_PORT, "DEMO_APP_PORT", 4101),
});
