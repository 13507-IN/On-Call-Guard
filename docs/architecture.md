# Prompt 2 architecture

## Services

| Workspace | Responsibility in this stage | Health endpoint |
| --- | --- | --- |
| `apps/demo-app` | Express demonstration app with MongoDB readiness and selectable release metadata | `GET /health`, `GET /version` |
| `services/api` | Express REST API shell and API descriptor | `GET /health`, `GET /api/v1` |
| `services/monitor` | Independent process shell only; no scheduled checks yet | `GET /health` |
| `services/triage` | Read-only process shell only; no AI integration yet | `GET /health` |
| `services/executor` | Process shell only; no recovery actions yet | `GET /health` |
| `apps/dashboard` | Next.js service-health view and health-check API routes | `GET /api/health`, `GET /api/services` |
| `packages/shared` | Structured JSON logging, request IDs, common Express health/error handling and port validation | — |

The dashboard performs checks only when its page loads or a user selects Refresh. It measures
response time and checks each service's health response; this is not a substitute for the
independent monitoring engine planned for a later stage. The demo app reports MongoDB readiness,
while the remaining scaffold services report process-only health.

## Request flow

The dashboard server reads endpoint URLs from environment variables, requests each service's
`/health` endpoint with a bounded timeout, checks the response shape and expected service identity,
and returns a sanitized status report. Browser clients never choose a target URL. Failures are
reported as unavailable without exposing network exception details.

## Containers

`infrastructure/docker/Dockerfile` builds any workspace selected through the `WORKSPACE` build
argument. `docker-compose.yml` runs MongoDB, the five Express services and dashboard with health
checks. MongoDB uses the `mongo-data` named volume; the demo app container never mounts or manages
the database's storage directly.
