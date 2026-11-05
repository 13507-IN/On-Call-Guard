# Unified incident management

Automatic monitoring and authenticated teammate reports use the same incident service, MongoDB
`incidents` collection, status model, dashboard, and persistent event history. New teammate reporter
identity is resolved from a server-side bearer token.

## Incident fields

Each record includes a UUID `incidentId`, title, description, `applicationId` and `applicationName`,
severity, status, source, reporter (when supplied), created/updated/detection timestamps, optional
assignee and investigation summary, recovery status, optional resolution timestamp, and a
chronological timeline.

Supported sources:

- `monitoring`: created after the configured consecutive failure threshold. It includes the latest
  health evidence and updates the active incident during the same outage.
- `manual_dashboard`: retained for dashboard-originated records created by other trusted callers.
- `team_report`: submitted by a teammate through the dedicated reporting endpoint or linked to an
  existing incident. The endpoint assigns this source; clients cannot label a teammate report as a
  different source. Reporter ID/name come from the token configuration. The incident description is
  always stored; original message, platform, channel/conversation reference, and message timestamp
  are optional context.

Reports are not merged based on title similarity. A teammate message can instead be explicitly
linked to an existing incident.

## API

All backend paths are under `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/incidents` | Create a `manual_dashboard` incident; requires a configured teammate bearer token |
| `POST` | `/incidents/reports` | Create a `team_report` incident; source and reporter are assigned by the API |
| `GET` | `/incidents` | List incidents; filter with `status`, `source`, `severity`, `applicationId`, `active`, and `limit` |
| `GET` | `/incidents/:incidentId` | Retrieve incident details |
| `PATCH` | `/incidents/:incidentId` | Update status, assignee, or investigation summary |
| `GET` | `/incidents/:incidentId/history` | Retrieve chronological timeline events |
| `POST` | `/incidents/:incidentId/reports` | Attach a teammate report to an existing incident; requires a configured teammate bearer token |

The dashboard exposes same-origin proxies under `/api/incidents` and `/api/incidents/reports`. It
forwards the bearer token in the `Authorization` header to the API and does not store it in browser
storage. The API ignores any client-supplied reporter identity, looks up the authenticated reporter,
assigns the source from the route, verifies the application ID against the configured monitored
application, and supplies the canonical application name. The shared incident service validates
and stores the incident and initial timeline event. Repeated
teammate reports are not merged by title; each submission creates a separate incident unless a
teammate explicitly links the report to an existing incident.

Status changes remain transition-checked and appended to the timeline. `resolved` is rejected unless
recovery status is `verified`; monitoring performs that verification using successful health checks.

## Teammate token setup

Set `TEAM_REPORTER_TOKENS` to a JSON object whose keys are unique 32–256 character URL-safe bearer
tokens and whose values contain a stable `id` and `name`. Example shape:

```json
{
  "replace-with-a-generated-token-of-at-least-32-characters": {
    "id": "teammate-1",
    "name": "Teammate Name"
  }
}
```

Keep this setting server-side and rotate tokens by replacing their entries. The example token in
`.env.example` is for local development only. The report UI does not retain a token after submission.
This token mechanism authenticates report creation and report linking only; incident status updates
and other dashboard write operations are not yet protected by user authentication. Use a trusted
network for the MVP, and HTTPS for non-local use.

## Testing

`npm test` covers monitoring-created incidents, authenticated report creation and source assignment,
forged reporter rejection, missing fields, invalid applications, repeated reports, report linking,
dashboard bearer forwarding, history ordering, query filters, guarded status transitions, and the
Mongo repository's behavior when a concurrent status update no longer matches its expected state.
