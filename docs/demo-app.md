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

## Local demonstration (PowerShell)

Set `MONGODB_URI` in `.env` to a reachable database, set `DEMO_APP_RELEASE=healthy`, then run
`npm run dev` from the repository root. Confirm the healthy release:

```powershell
Invoke-RestMethod http://localhost:4101/version
Invoke-RestMethod http://localhost:4101/health
```

To trigger a real health failure, change `DEMO_APP_RELEASE` to `broken` in `.env`, stop the
development processes with `Ctrl+C`, and restart them with `npm run dev`:

```powershell
Invoke-RestMethod http://localhost:4101/version
try { Invoke-WebRequest http://localhost:4101/health } catch { $_.Exception.Response.StatusCode }
```

The health request returns HTTP 503 for the broken release. Restore `DEMO_APP_RELEASE=healthy` in
`.env` and restart `npm run dev`. The broken release only pings an unavailable host; it performs no
database writes and does not alter existing data.
