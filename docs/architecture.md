# Prompt 4 architecture

## Services

| Workspace | Responsibility in this stage | Relevant endpoints |
| --- | --- | --- |
| `apps/demo-app` | Versioned Express demo app; readiness includes MongoDB ping | `GET /health`, `GET /version` |
| `services/monitor` | Independent periodic HTTP health checks; submits results to the API | `GET /health`, `GET /api/v1/status` |
| `services/api` | Authenticated monitoring ingestion, shared incident creation/lifecycle, persistent event history, and report linking | `GET /health`, `/api/v1/monitoring/*`, `/api/v1/incidents/*` |
| `apps/dashboard` | Monitoring overview, incident list/filters, dashboard and simulated teammate reports, incident details/history | `/api/monitoring`, `/api/incidents/*` |
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
| `POST /api/v1/incidents` | Create a dashboard or teammate report | None in this MVP |
| `GET /api/v1/incidents?active=true&limit=50` | List incidents; optional status, source, severity, application and limit filters | None |
| `GET /api/v1/incidents/:incidentId` | Retrieve one incident by UUID | None |
| `PATCH /api/v1/incidents/:incidentId` | Update status, assignee, or investigation summary | None in this MVP |
| `GET /api/v1/incidents/:incidentId/history` | Retrieve chronologically ordered timeline events | None |
| `POST /api/v1/incidents/:incidentId/reports` | Link an explicit teammate message to an incident | None in this MVP |

The dashboard's `/api/monitoring` and `/api/incidents/*` handlers are same-origin server-side proxies
to the API. The browser never receives the monitor ingestion token. These incident endpoints do not
authenticate users in this MVP.

## Local development runtime

Run the Node.js services on the host with `npm run dev`. MongoDB is an independent prerequisite and
can be a local server or a hosted database configured through `MONGODB_URI`. The demo app and API
connect to that database; the monitor and API share the monitoring policy and ingestion token. The
dashboard receives only the API URL and never receives the ingestion token. Docker is not required
for this stage.

## Unified incident flow

1. Monitoring incidents and dashboard/team reports enter through one `incident-service.js`.
2. The service validates records, assigns IDs/default severity, stores a timestamped creation event,
   and persists all sources to the MongoDB `incidents` collection.
3. Monitoring reuses its active incident for the same application during an ongoing outage; human
   reports remain independent unless explicitly linked to an incident.
4. Status transitions append events. A generic status update cannot resolve an incident until
   recovery has been verified.
5. The dashboard loads incident data from the API, supports source/status/severity filters, and
   renders detail and chronological history views.

See [incident-management.md](incident-management.md) for fields, endpoints, and the current
authentication boundary. Actual communication-platform integrations, AI triage, Telegram,
approval workflows, and recovery execution remain later stages. The demo app's healthy and broken
release behavior is documented in [demo-app.md](demo-app.md).
