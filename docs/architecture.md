# Prompt 1 architecture

## Services

| Workspace | Responsibility in this stage | Health endpoint |
| --- | --- | --- |
| `apps/demo-app` | Minimal Express application with a landing page | `GET /health` |
| `services/api` | Express REST API shell and API descriptor | `GET /health`, `GET /api/v1` |
| `services/monitor` | Independent process shell only; no scheduled checks yet | `GET /health` |
| `services/triage` | Read-only process shell only; no AI integration yet | `GET /health` |
| `services/executor` | Process shell only; no recovery actions yet | `GET /health` |
| `apps/dashboard` | Next.js service-health view and health-check API routes | `GET /api/health`, `GET /api/services` |
| `packages/shared` | Structured JSON logging, request IDs, common Express health/error handling and port validation | — |

The dashboard performs checks only when its page loads or a user selects Refresh. Those requests
measure process reachability and response time; they are not a substitute for the independent
monitoring engine planned for a later stage. Health responses explicitly identify their scope as
`process-only`. MongoDB and dependency readiness are not included in Prompt 1.

## Request flow

The dashboard server reads endpoint URLs from environment variables, requests each service's
`/health` endpoint with a bounded timeout, checks the response shape and expected service identity,
and returns a sanitized status report. Browser clients never choose a target URL. Failures are
reported as unavailable without exposing network exception details.

## Containers

`infrastructure/docker/Dockerfile` builds any workspace selected through the `WORKSPACE` build
argument. `docker-compose.yml` runs the five Express services and dashboard with health checks.
No database or persistent volume is configured in this stage.
