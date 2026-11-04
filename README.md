# On-call Incident Assistant

Prompt 1 scaffold for an AI-assisted incident-response platform. This stage provides independent
service processes, process-only health endpoints, a basic REST API, a demo application, a Next.js
dashboard, and Docker Compose configuration.

No MongoDB, scheduled monitoring, incident lifecycle, AI, Telegram integration, or recovery actions
are implemented in this stage. Dashboard checks happen only when the page loads or a user selects
Refresh; they do not create incidents.

## Requirements

- Node.js 22.9 or newer
- npm
- Docker Desktop with Docker Compose, only if using the container workflow

## Install and run locally

From the repository root:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The development command starts all five Express services and the Next.js dashboard. Stop all
processes with `Ctrl+C`.

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

The Express services expose `GET /health`. These responses report process health only; they do
not check MongoDB or other dependencies. The monitor, triage, and executor endpoints are service
shells, not implementations of those capabilities.

Set the corresponding `*_PORT`, `*_URL`, `DASHBOARD_PORT`, or `HEALTH_CHECK_TIMEOUT_MS` values in
`.env` to change the local configuration. Dashboard endpoint URLs are read by the server and are
not accepted from browser requests.

## Docker Compose

With Docker Desktop running:

```powershell
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up --build
```

The Compose stack exposes the dashboard at port 3002 and the Express services at ports 4100–4104.
To stop it:

```powershell
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml down
```

No persistent volumes are configured in Prompt 1 because no database is part of this stage.

## Tests and dashboard build

```powershell
npm test
npm run build
```

## Service responsibilities

See [docs/architecture.md](docs/architecture.md). The dashboard visual direction and scope are
recorded in [docs/dashboard-design.md](docs/dashboard-design.md).
