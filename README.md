# On-call Incident Assistant

Prompt 4 adds unified incident management to the existing monitoring system. Monitoring-detected
outages, dashboard reports, and simulated teammate reports use one incident service and MongoDB
collection. The dashboard lists and filters incidents, preserves report details, and shows each
incident's persistent event history.

The independent monitor and demo application from Prompt 3 remain intact. AI diagnosis, actual Slack
or Discord integration, Telegram, approval workflows, and recovery execution are not part of this stage.

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

The development command starts the demo app, API, monitor, existing triage/executor shells, and
dashboard as local Node.js processes. Before starting them, make sure MongoDB is running and that
`MONGODB_URI` in `.env` points to it. The demo app and API use the same database; the monitor sends
checks to the API using the local development token. Stop the Node.js processes with `Ctrl+C`.

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
| Triage service shell | http://localhost:4103 |
| Recovery executor shell | http://localhost:4104 |

The demo app's `GET /health` performs a real MongoDB ping and returns HTTP 503 if MongoDB is
unavailable. The monitor checks this endpoint every 30 seconds by default. Three consecutive
failures create one active incident; subsequent failures update it. Two consecutive healthy checks
resolve the incident. Recovery verification is based on actual health responses, not a requested
action.

## Configuration

Copy `.env.example` to `.env` and adjust the monitoring variables as needed:

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

The example ingestion token is for local development; replace it with a unique secret before
sharing or deploying the stack. The dashboard does not receive this token.

Dashboard service URLs and ports can also be changed using the `*_URL`, `*_PORT`,
`DASHBOARD_PORT`, and `HEALTH_CHECK_TIMEOUT_MS` variables.

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
detection, incident deduplication and recovery verification, dashboard and teammate incident
creation, report linking, timeline retrieval, status validation, and dashboard API helpers.

## Service responsibilities

See [docs/architecture.md](docs/architecture.md) for the request flow, [docs/incident-management.md](docs/incident-management.md)
for incident fields and API behavior, and [docs/monitoring.md](docs/monitoring.md)
for monitoring configuration. The existing demo application is described in
[docs/demo-app.md](docs/demo-app.md). The dashboard visual direction is recorded in
[docs/dashboard-design.md](docs/dashboard-design.md).
