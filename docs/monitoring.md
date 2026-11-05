# Monitoring and automatic incident detection

The monitor is an independent Node.js service. It checks the demo app's `GET /health` endpoint on a
fixed interval, stores each result through the REST API, and keeps running while the app is
unavailable.

## Check and incident behavior

- A check is healthy only when the endpoint responds successfully with `status: "ok"` and the
  expected application service identifier.
- HTTP errors, invalid health responses, timeouts, and network errors are stored as failed checks
  with a normalized reason. Raw error text is not stored.
- Three consecutive failures open one `critical` incident by default. The first failure is recorded
  as the incident start; the threshold-crossing check is the detection time.
- Further failed checks update the same active incident and its latest observed failure.
- Two consecutive successful checks resolve the incident by default. One success is not sufficient.
- Duplicate check IDs are idempotently ignored. MongoDB also enforces one active incident per
  application.
- Every check, monitor state and incident is stored in MongoDB. API and monitor restarts do not
  clear this data.

## Environment

Both `services/api` and `services/monitor` read the shared monitoring configuration:

| Variable | Default | Validated range / behavior |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/oncall_demo?directConnection=true` | MongoDB connection used by the demo app and API |
| `MONITORED_APP_ID` | `demo-app` | 1–64 letters, digits, `_` or `-` |
| `MONITORED_APP_NAME` | `Demo application` | 1–100 non-blank characters |
| `MONITORED_APP_URL` | `http://127.0.0.1:4101` | HTTP(S) URL without embedded credentials |
| `MONITOR_INTERVAL_MS` | `30000` | 1,000–3,600,000 ms |
| `MONITOR_TIMEOUT_MS` | `5000` | 100–60,000 ms |
| `MONITOR_FAILURE_THRESHOLD` | `3` | 1–100 consecutive failures |
| `MONITOR_RECOVERY_THRESHOLD` | `2` | 1–100 consecutive successes |
| `MONITOR_INGEST_TOKEN` | required | 24–256 characters |
| `API_URL` | `http://127.0.0.1:4100` | API base URL |

Set the same MongoDB URI for the demo app and API, and the same application identity, thresholds,
and token for the API and monitor. MongoDB can run locally or be hosted; no Docker setup is required.
The repository `.env.example` contains a local-only development token. Generate a unique secret for
any shared environment, keep it out of source control, and do not expose it to the dashboard.

## API details

`GET /api/v1/monitoring/status` returns the latest check, recent check history, configured policy,
failure/success counters, and whether checks are starting, active, or stale.

`POST /api/v1/monitoring/checks` accepts:

```json
{
  "applicationId": "demo-app",
  "applicationName": "Demo application",
  "check": {
    "checkId": "440e8400-e29b-41d4-a716-446655440000",
    "checkedAt": "2026-11-05T08:00:00.000Z",
    "status": "unavailable",
    "httpStatus": 503,
    "latencyMs": 12.4,
    "failureReason": "http_status",
    "checks": {
      "process": "ok",
      "mongodb": "unavailable"
    }
  }
}
```

It requires the monitor bearer token. The API validates identifiers, UUID, timestamps, status,
latency, HTTP status and bounded readiness evidence before persistence.

`GET /api/v1/incidents?active=true` lists active incidents. `GET /api/v1/incidents/:incidentId`
returns an incident document, including bounded recent failure evidence and recovery verification.

## Local demonstration

1. Make sure MongoDB is running locally or set `MONGODB_URI` in `.env` to a reachable hosted
   database. Then install dependencies and start the Node.js services:

   ```powershell
   Copy-Item .env.example .env
   npm install
   npm run dev
   ```

2. Confirm the application and monitor:

   ```powershell
   Invoke-RestMethod http://localhost:4101/health
   Invoke-RestMethod http://localhost:4102/api/v1/status
   ```

3. Set `DEMO_APP_RELEASE=broken` in `.env`, stop the local Node.js processes with `Ctrl+C`, and run
   `npm run dev` again.
4. Wait through three configured monitoring intervals. Check the dashboard or call
   `GET http://localhost:4100/api/v1/incidents?active=true`.
5. Set `DEMO_APP_RELEASE=healthy` in `.env` and restart `npm run dev`. After two consecutive passing
   checks, the incident is resolved automatically.

The broken release only makes its MongoDB readiness target unavailable; it does not modify or
delete MongoDB data. See [demo-app.md](demo-app.md) for the release implementation.
