# AI incident investigation

Prompt 6 adds one investigation workflow for `monitoring`, `team_report`, and `manual_dashboard`
incidents. The API assembles evidence from the incident record, its timeline, recent persisted
health checks, the application's current `/health` and `/version` endpoints, and any attached
teammate reports. It sends that context to the internal triage service and stores a validated
diagnosis under `incident.investigation.diagnosis`.

## Local OpenCode and Switch.ai setup

1. Configure Switch.ai as a provider in the local OpenCode installation.
2. Start the OpenCode headless server from a terminal with
   `opencode serve --hostname 127.0.0.1 --port 4096`.
3. Copy `.env.example` to `.env`. Set `OPENCODE_URL` if the server uses a different address.
4. Set a unique `TRIAGE_SERVICE_TOKEN` in `.env`. The same value authenticates API-to-triage calls.
5. Restart the project with `npm run dev`.
6. Open an incident, provide a valid configured teammate token, and select **Start investigation**.

OpenCode's local server uses the provider and default model configured in OpenCode. This project
does not need a Switch.ai API key. If OpenCode server authentication is enabled, set
`OPENCODE_SERVER_PASSWORD` and its username in `.env`.

OpenCode's documented server and JavaScript SDK interfaces are used:

- [OpenCode server](https://opencode.ai/docs/server)
- [OpenCode JavaScript SDK](https://opencode.ai/docs/sdk)
- [OpenCode agent permissions](https://opencode.ai/docs/agents#permissions)

## Security and lifecycle

- Only a teammate authenticated by `TEAM_REPORTER_TOKENS` can trigger an investigation.
- The API-to-triage route uses a separate `TRIAGE_SERVICE_TOKEN`.
- Each OpenCode session receives a deny-all permission ruleset; the model receives collected
  evidence in its prompt and is not given shell, file, web, or recovery tools.
- The OpenCode session is deleted after the response is processed. The validated diagnosis and
  investigation events remain in MongoDB.
- Diagnosis output is schema-validated in the triage service and validated again by the API.
- Only facts derived from collected incident, health, monitoring, deployment, and timeline records
  are labeled confirmed. Model-supplied evidence is labeled as an unverified hypothesis, and
  purported log excerpts are discarded while logs are unavailable.
- Failure states and safe error codes are persisted. Failed investigations can be retried, while a
  MongoDB compare-and-set claim prevents duplicate concurrent work for the same incident.
- A diagnosis is advisory. Recommendations do not execute recovery, and the incident remains in
  `investigating`; the resolution status still depends on existing health verification.

Incident content and evidence are sent to the provider configured in OpenCode. Do not include
credentials, secrets, or unrelated personal data in incident reports. Keep the OpenCode server
bound to localhost unless a separately secured deployment is intentionally configured.

## Evidence availability and current limitations

- Monitoring check history and the incident timeline are read from MongoDB.
- Current health and release information are fetched from the configured monitored application.
- The demo application currently writes structured logs to stdout but does not persist or expose
  them, so application log excerpts are reported as unavailable.
- The application exposes its current release through `/version`; historical deployment records
  are not available in this stage.
- Missing endpoints, provider failures, and missing logs/deployment history are represented as
  limitations instead of being inferred as facts.

The API endpoints are:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/incidents/:incidentId/investigations` | Start/retry an investigation; requires a teammate bearer token |
| `GET` | `/api/v1/incidents/:incidentId/investigation` | Retrieve the current investigation state |

The POST route is also available through the dashboard's same-origin
`/api/incidents/:incidentId/investigations` endpoint. The incident detail view shows state,
summary, probable cause, evidence classification, confidence, recommended steps/action, risk, and
missing information.
