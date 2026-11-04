import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import express from "express";
import { createLogger } from "./logger.js";

export function createServiceApp({
  serviceName,
  description,
  configureRoutes = () => {},
  readinessCheck = null,
  logger = createLogger(serviceName),
}) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const requestPath = req.path;
    const startedAt = performance.now();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
      logger.info("http_request_completed", {
        requestId,
        method: req.method,
        path: requestPath,
        statusCode: res.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      });
    });

    next();
  });

  app.use(express.json({ limit: "100kb" }));

  app.get("/health", async (req, res) => {
    if (!readinessCheck) {
      res.status(200).json({
        status: "ok",
        service: serviceName,
        checkedAt: new Date().toISOString(),
        checks: { process: "ok" },
        scope: "process-only",
      });
      return;
    }

    try {
      const result = await readinessCheck();
      const ready = result?.ready === true;
      res.status(ready ? 200 : 503).json({
        status: ready ? "ok" : "unavailable",
        service: serviceName,
        checkedAt: new Date().toISOString(),
        checks: result?.checks ?? { process: "ok", dependency: "unavailable" },
        scope: result?.scope ?? "application-readiness",
      });
    } catch (error) {
      logger.warn("health_check_failed", {
        requestId: req.requestId,
        errorName: error?.name || "Error",
      });
      res.status(503).json({
        status: "unavailable",
        service: serviceName,
        checkedAt: new Date().toISOString(),
        checks: { process: "ok", dependency: "unavailable" },
        scope: "application-readiness",
      });
    }
  });

  configureRoutes(app);

  app.get("/", (_req, res) => {
    res.json({ service: serviceName, description });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: req.requestId,
      },
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const candidateStatus = Number(error.status);
    const statusCode =
      Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
        ? candidateStatus
        : 500;
    const isClientError = statusCode < 500;
    const code =
      statusCode === 400
        ? "BAD_REQUEST"
        : statusCode === 413
          ? "PAYLOAD_TOO_LARGE"
          : isClientError
            ? "REQUEST_REJECTED"
            : "INTERNAL_SERVER_ERROR";

    logger[isClientError ? "warn" : "error"]("http_request_failed", {
      requestId: req.requestId,
      statusCode,
      errorName: error.name || "Error",
    });

    res.status(statusCode).json({
      error: {
        code,
        message: isClientError ? "Request could not be processed." : "An unexpected error occurred.",
        requestId: req.requestId,
      },
    });
  });

  return app;
}

export function startService({ app, serviceName, port, onShutdown = async () => {} }) {
  const logger = createLogger(serviceName);
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info("server_started", { port, nodeEnv: process.env.NODE_ENV || "development" });
  });

  let isShuttingDown = false;
  const shutdown = (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("server_shutdown_started", { signal });

    server.close(async (error) => {
      if (error) {
        logger.error("server_shutdown_failed", { errorName: error.name });
        process.exitCode = 1;
      }

      try {
        await onShutdown();
      } catch (shutdownError) {
        logger.error("service_cleanup_failed", { errorName: shutdownError?.name || "Error" });
        process.exitCode = 1;
      }
      logger.info("server_stopped", { signal });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  server.on("error", (error) => {
    logger.error("server_error", { errorName: error.name, errorCode: error.code });
    process.exitCode = 1;
  });

  return server;
}
