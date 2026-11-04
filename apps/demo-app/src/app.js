import { createServiceApp } from "@oncall/shared/http-service";

export function createDemoApp({ release, checkDatabase, logger }) {
  return createServiceApp({
    serviceName: "demo-app",
    description: "Versioned demo application with MongoDB readiness checks.",
    logger,
    readinessCheck: async () => {
      const databaseStatus = await checkDatabase();
      return {
        ready: databaseStatus === "ok",
        checks: {
          process: "ok",
          mongodb: databaseStatus,
        },
        scope: "application-readiness",
      };
    },
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
      code { overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <h1>On-call demo application</h1>
      <p>This versioned Express app checks its MongoDB dependency before reporting ready.</p>
      <p>Current release: <code>${release.releaseId}</code> (version ${release.version}).</p>
      <p><a href="/health"><code>/health</code></a> checks application and database readiness.</p>
      <p><a href="/version"><code>/version</code></a> reports the active release identifier.</p>
    </main>
  </body>
</html>`);
      });

      service.get("/version", (_req, res) => {
        res.json({
          service: "demo-app",
          release: release.releaseId,
          releaseMode: release.mode,
          version: release.version,
        });
      });
    },
  });
}

