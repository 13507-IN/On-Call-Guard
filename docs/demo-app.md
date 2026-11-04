# Demo application

The demo application is an isolated target for exercising readiness checks and, in a later stage,
the incident lifecycle. It exposes a homepage, `GET /health`, and `GET /version`.

## Readiness contract

`GET /health` runs MongoDB's `ping` command using the official Node.js driver. A successful ping
returns HTTP 200 with `status: "ok"` and `checks.mongodb: "ok"`. A failed ping returns HTTP 503
with `status: "unavailable"` and `checks.mongodb: "unavailable"`. Driver error messages and
connection strings are not returned to HTTP callers or written to application logs.

The app process remains running if MongoDB is unavailable, so `/health` can report the dependency
failure and `/version` remains reachable. MongoDB readiness is bounded by the driver's two-second
server-selection timeout.

## Releases

`GET /version` returns the active release identifier and semantic version:

| `DEMO_APP_RELEASE` | Release ID | Version | Behavior |
| --- | --- | --- | --- |
| `healthy` | `demo-healthy-1.0.0` | `1.0.0` | Connects to the configured MongoDB instance |
| `broken` | `demo-broken-1.1.0` | `1.1.0` | Uses a reserved, unavailable hostname, causing MongoDB readiness to fail |

Select a mode with `DEMO_APP_RELEASE`. The mode is validated at startup; any other value prevents
the app from starting. The broken release does not issue database writes, alter collections, or
mount database storage. It only attempts the same read-only ping against an unreachable host.

## Demonstration with Docker Compose (PowerShell)

Start the stack using the repository's `.env` file:

```powershell
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up --build -d
```

Confirm the healthy release:

```powershell
Invoke-RestMethod http://localhost:4101/version
Invoke-RestMethod http://localhost:4101/health
```

Switch only the demo app to the broken release:

```powershell
$env:DEMO_APP_RELEASE = "broken"
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d --no-deps --force-recreate demo-app
Remove-Item Env:DEMO_APP_RELEASE
Invoke-WebRequest http://localhost:4101/health
```

The last request should return HTTP 503. Restore the prior healthy release:

```powershell
$env:DEMO_APP_RELEASE = "healthy"
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d --no-deps --force-recreate demo-app
Remove-Item Env:DEMO_APP_RELEASE
Invoke-RestMethod http://localhost:4101/health
```

The `mongo-data` named volume is preserved when the containers are stopped or recreated. The
Compose MongoDB port is bound to localhost only. Do not use `docker compose down --volumes` if
you want to retain that data.

## Local Node.js development

Set `MONGODB_URI` in `.env` to a local MongoDB instance, then start the `mongodb` Compose service
and run `npm run dev`. To exercise the broken release locally, set `DEMO_APP_RELEASE=broken` in
the process environment before starting `apps/demo-app`; restart with `DEMO_APP_RELEASE=healthy`
to restore the previous release.

