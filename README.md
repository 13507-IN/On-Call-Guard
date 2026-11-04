# On-call Incident Assistant

Prompt 2 implementation for an AI-assisted incident-response platform. The demo application now
has versioned healthy and deliberately broken releases, MongoDB-backed readiness, and persistent
MongoDB storage. The remaining scaffold services still expose process-only health endpoints.

Scheduled monitoring, incident lifecycle, AI, Telegram integration, and recovery actions are not
implemented yet. Dashboard checks happen only when the page loads or a user selects Refresh; they do
not create incidents.

## Requirements

- Node.js 22.9 or newer
- npm
- Docker Desktop with Docker Compose, to run MongoDB locally or use the container workflow

## Install and run locally

From the repository root:

```powershell
Copy-Item .env.example .env
npm install
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d mongodb
npm run dev
```

The development command starts all five Express services and the Next.js dashboard. MongoDB runs
in Docker with its port bound to localhost; the demo app connects using `MONGODB_URI`. Stop the
Node.js processes with `Ctrl+C`. Stop the database container with the Compose `stop mongodb`
command; its named volume keeps the data.

| Service | Local URL |
| --- | --- |
| Dashboard | http://localhost:3002 |
| Dashboard process health | http://localhost:3002/api/health |
| Dashboard on-demand service report | http://localhost:3002/api/services |
| REST API | http://localhost:4100 |
| REST API descriptor | http://localhost:4100/api/v1 |
| Demo application | http://localhost:4101 |
| Monitor service shell | http://localhost:4102 |
| Triage service shell | http://localhost:4103 |
| Recovery executor shell | http://localhost:4104 |

The demo app's `GET /health` performs a real MongoDB `ping` and returns HTTP 503 if the database
cannot be reached. Other Express service health endpoints report process health only. The monitor,
triage, and executor endpoints are service shells, not implementations of those capabilities.

Set the corresponding `*_PORT`, `*_URL`, `DASHBOARD_PORT`, or `HEALTH_CHECK_TIMEOUT_MS` values in
`.env` to change the local configuration. Dashboard endpoint URLs are read by the server and are
not accepted from browser requests.

See [docs/demo-app.md](docs/demo-app.md) for release identifiers and the healthy-to-broken-to-healthy
demonstration procedure.

## Docker Compose

With Docker Desktop running:

```powershell
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up --build
```

The Compose stack exposes the dashboard at port 3002, the Express services at ports 4100–4104, and
MongoDB on localhost port 27017. The demo database is stored in the `mongo-data` named volume.
To stop it:

```powershell
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml down
```

`down` keeps the MongoDB volume. Do not add `--volumes` / `-v` if you need to preserve demo data.

## Tests and dashboard build

```powershell
npm test
npm run build
```

## Service responsibilities

See [docs/architecture.md](docs/architecture.md). The dashboard visual direction and scope are
recorded in [docs/dashboard-design.md](docs/dashboard-design.md).
