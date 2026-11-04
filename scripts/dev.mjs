import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePort } from "../packages/shared/src/port.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const dashboardDirectory = fileURLToPath(new URL("../apps/dashboard/", import.meta.url));
const dashboardPort = parsePort(process.env.DASHBOARD_PORT, "DASHBOARD_PORT", 3002);
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

const processes = [
  ["demo-app", "apps/demo-app/src/server.js"],
  ["api", "services/api/src/server.js"],
  ["monitor", "services/monitor/src/server.js"],
  ["triage", "services/triage/src/server.js"],
  ["executor", "services/executor/src/server.js"],
].map(([name, entry]) => ({
  name,
  command: process.execPath,
  args: ["--watch", entry],
}));

processes.push({
  name: "dashboard",
  command: process.execPath,
  args: [nextCli, "dev", "--hostname", "0.0.0.0", "--port", String(dashboardPort)],
  cwd: dashboardDirectory,
});

const children = [];
let shuttingDown = false;

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const { child } of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const service of processes) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd ?? repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  children.push({ name: service.name, child });

  child.on("error", (error) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "dev_process_failed_to_start",
      service: service.name,
      errorName: error.name,
    }));
    process.exitCode = 1;
    stopAll();
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "dev_process_exited",
      service: service.name,
      code,
      signal,
    }));
    process.exitCode = code ?? 1;
    stopAll();
  });
}

process.once("SIGINT", () => stopAll("SIGINT"));
process.once("SIGTERM", () => stopAll("SIGTERM"));
