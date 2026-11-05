# Prompt 3 architecture

## Services

| Workspace | Responsibility in this stage | Relevant endpoints |
| --- | --- | --- |
| `apps/demo-app` | Versioned Express demo app; readiness includes MongoDB ping | `GET /health`, `GET /version` |
| `services/monitor` | Independent periodic HTTP health checks; submits results to the API | `GET /health`, `GET /api/v1/status` |
| `services/api` | Authenticated monitoring ingestion, check history, incident lifecycle and retrieval | `GET /health`, `GET /api/v1/monitoring/status`, `POST /api/v1/monitoring/checks`, incident GET routes |
| `apps/dashboard` | Current app/monitor status and open incident view; refreshes from backend data | `GET /api/monitoring`, `GET /api/incidents` |
| `services/triage` | Process health shell; AI diagnosis is not implemented yet | `GET /health` |
| `services/executor` | Process health shell; recovery operations are not implemented yet | `GET /health` |
| `packages/shared` | JSON logging, request IDs, service health/error handling, monitor configuration and event validation | — |
| MongoDB | Persistent health-check history, monitor state and incident documents | Internal database |

## Automatic monitoring flow

1. The monitor requests the configured application's `/health` endpoint with a bounded timeout.
2. It records HTTP status, response latency, timestamp, readiness checks, and a normalized failure
   reason. Raw network exception text and credentials are not submitted.
3. The monitor sends the event to the API with `Authorization: Bearer <MONITOR_INGEST_TOKEN>`.
4. The API validates the token and event, persists the check, and updates consecutive success/failure
   state in MongoDB.
5. At the configured failure threshold (three by default), the API creates one active incident for
   that application. Further failures update that incident.
6. The incident resolves only after the configured consecutive successful health checks (two by
   default). Its record includes the recovery check and measured outage duration.
7. The dashboard loads monitoring status and active incidents from the API on the server, then
   refreshes through same-origin Next.js route handlers. Browser requests never provide a backend
   target URL or the ingestion token.

Monitoring state is persisted so API restarts do not reset the failure/success counters. A unique
sparse index on the active application identifier prevents duplicate active incidents for the same
application.

## API

| Method and path | Purpose | Authentication |
| --- | --- | --- |
| `GET /api/v1/monitoring/status` | Current monitor freshness, latest check, recent checks and counters | None |
| `POST /api/v1/monitoring/checks` | Persist a check and update incident state | Monitor bearer token |
| `GET /api/v1/incidents?active=true&limit=50` | List active incidents; optional status and limit filters | None |
| `GET /api/v1/incidents/:incidentId` | Retrieve one incident by UUID | None |

The dashboard's `GET /api/monitoring` and `GET /api/incidents` endpoints are server-side proxies to
the API. All monitoring responses use `Cache-Control: no-store`.

## Local development runtime

Run the Node.js services on the host with `npm run dev`. MongoDB is an independent prerequisite and
can be a local server or a hosted database configured through `MONGODB_URI`. The demo app and API
connect to that database; the monitor and API share the monitoring policy and ingestion token. The
dashboard receives only the API URL and never receives the ingestion token. Docker is not required
for this stage.

## Scope boundary

This stage implements automatic monitoring and incident creation only. Manual incident intake,
AI triage, Telegram, approval workflows, and recovery execution are not implemented. The demo app's
healthy and broken release behavior is documented in [demo-app.md](demo-app.md).
