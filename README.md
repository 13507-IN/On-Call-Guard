# On-call Incident Assistant

Prompt 6 adds read-only AI incident investigation to the unified incident system. Monitoring
alerts and teammate reports share the same incident records, investigation workflow, dashboard,
and persistent timeline. Reporter identities are resolved from server-side bearer-token
configuration, not from client-supplied names.

The independent monitor and demo application remain intact. Switch Console can route Discord and
Telegram team messages to the restricted on-call OpenCode agent. Recovery execution is not included.

## Requirements

- Node.js 22.9 or newer
- npm
- A reachable MongoDB instance (local MongoDB or a hosted MongoDB connection string)

## Install and run locally

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The development command starts the demo app, API, monitor, triage service, executor shell, and
dashboard as local Node.js processes. Before starting them, make sure MongoDB is running and that
`MONGODB_URI` in `.env` points to it. The demo app and API use the same database; the monitor sends
checks to the API using its local development token. Incident reporting and investigation require a
teammate token configured in `TEAM_REPORTER_TOKENS`. AI investigation also requires a local
OpenCode server and the internal `TRIAGE_SERVICE_TOKEN`. Stop the Node.js processes with `Ctrl+C`.

For local MongoDB, the example URI expects a server on `127.0.0.1:27017`. Alternatively, set
`MONGODB_URI` to a hosted MongoDB connection string. Keep credentials out of source control.

| Service | Local URL |
| --- | --- |
| Dashboard | http://localhost:3002 |
| Dashboard process health | http://localhost:3002/api/health |
| Dashboard on-demand service report | http://localhost:3002/api/services |
| REST API | http://localhost:4100 |
| API descriptor | http://localhost:4100/api/v1 |
| Monitoring status | http://localhost:4100/api/v1/monitoring/status |
| Active incidents | http://localhost:4100/api/v1/incidents?active=true |
| Incident history | http://localhost:3002/incidents |
| Demo application | http://localhost:4101 |
| Monitor service status | http://localhost:4102/api/v1/status |
| Triage service | http://localhost:4103 |
| Recovery executor shell | http://localhost:4104 |

The demo app's `GET /health` performs a real MongoDB ping and returns HTTP 503 if MongoDB is
unavailable. The monitor checks this endpoint every 30 seconds by default. Three consecutive
failures create one active incident; subsequent failures update it. Two consecutive healthy checks
resolve the incident. Recovery verification is based on actual health responses, not a requested
action.

## Configuration

Copy `.env.example` to `.env` and adjust the monitoring and reporting variables as needed:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/oncall_demo?directConnection=true` | MongoDB connection used by the demo app and API |
| `MONITORED_APP_ID` | `demo-app` | Stable identifier stored with checks/incidents |
| `MONITORED_APP_NAME` | `Demo application` | Display name |
| `MONITORED_APP_URL` | `http://127.0.0.1:4101` | Application base URL |
| `MONITOR_INTERVAL_MS` | `30000` | Delay between checks |
| `MONITOR_TIMEOUT_MS` | `5000` | Health request timeout |
| `MONITOR_FAILURE_THRESHOLD` | `3` | Consecutive failures before opening an incident |
| `MONITOR_RECOVERY_THRESHOLD` | `2` | Consecutive successes before resolving it |
| `MONITOR_INGEST_TOKEN` | local example value | Bearer token shared only by monitor and API |
| `TEAM_REPORTER_TOKENS` | local example mapping | Server-only JSON mapping bearer tokens to reporter `id` and `name` |
| `TRIAGE_SERVICE_TOKEN` | local example value | Internal bearer token shared by API and triage service |
| `TRIAGE_URL` | `http://127.0.0.1:4103` | API-to-triage service URL |
| `TRIAGE_TIMEOUT_MS` | `60000` | Maximum OpenCode diagnosis time |
| `OPENCODE_URL` | `http://127.0.0.1:4096` | Local OpenCode server URL |
| `OPENCODE_SERVER_USERNAME` | `opencode` | Optional OpenCode HTTP Basic username |
| `OPENCODE_SERVER_PASSWORD` | empty | Optional OpenCode HTTP Basic password |

The example ingestion token is for local development; replace it with a unique secret before
sharing or deploying the stack. Replace the example teammate token as well. Generate a token with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`, then map it
to a stable teammate ID and display name in the `.env` JSON. The dashboard asks the teammate for
their token when submitting; it is sent in an authorization header, is not persisted in browser
storage, and is never included in the incident body. Use HTTPS outside local development. Do not
prefix `TEAM_REPORTER_TOKENS` with `NEXT_PUBLIC_`.

Dashboard service URLs and ports can also be changed using the `*_URL`, `*_PORT`,
`DASHBOARD_PORT`, and `HEALTH_CHECK_TIMEOUT_MS` variables.

For AI investigation, keep using the existing OpenCode provider configuration, start OpenCode's
documented headless server, and set `OPENCODE_URL` if it is not using the default address. The
application does not receive the provider API key. Switch Console is the separate communication
layer; it does not replace the investigation provider. Investigation setup and evidence limitations
are documented in [docs/ai-investigation.md](docs/ai-investigation.md).

For team communication, see [docs/switch-console-integration.md](docs/switch-console-integration.md)
for Switch Console setup, Discord/Telegram connectors, agent access controls, and required secrets.

## End-to-end monitoring demonstration

See [docs/demo-app.md](docs/demo-app.md) for release behavior. To trigger the deliberately
broken release, change `DEMO_APP_RELEASE=healthy` to `DEMO_APP_RELEASE=broken` in `.env`, stop the
development processes with `Ctrl+C`, and run:

```powershell
npm run dev
```

The monitor creates one incident after the configured consecutive failures. Restore
`DEMO_APP_RELEASE=healthy` and restart `npm run dev`; the incident resolves after the configured
number of successful health checks. Restarting local services does not delete MongoDB records.

## Tests and build

```powershell
npm test
npm run build
```

The automated suite covers health responses, HTTP 500, timeout/network failures, three-failure
detection, incident deduplication and recovery verification, authenticated teammate reporting,
server-assigned incident source, reporter identity preservation, invalid applications, report
linking, timeline retrieval, investigation source parity, evidence collection, missing context,
provider failures, authorization, retry and duplicate-run prevention, diagnosis validation,
read-only OpenCode permissions, chat command parsing, authenticated API calls and Discord/Telegram
event idempotency, response formatting, status validation, and dashboard API helpers.

## Service responsibilities

See [docs/architecture.md](docs/architecture.md) for the request flow,
[docs/incident-management.md](docs/incident-management.md) for incident fields and API behavior,
[docs/monitoring.md](docs/monitoring.md) for monitoring configuration,
[docs/ai-investigation.md](docs/ai-investigation.md) for investigation behavior, and
[docs/switch-console-integration.md](docs/switch-console-integration.md) for team communication. The
existing demo application is described in [docs/demo-app.md](docs/demo-app.md). The dashboard visual
direction is recorded in [docs/dashboard-design.md](docs/dashboard-design.md).
