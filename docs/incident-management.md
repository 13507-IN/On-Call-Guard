# Unified incident management

Prompt 4 stores all incident sources in the existing MongoDB `incidents` collection. Automatic
monitoring, dashboard reports, and simulated teammate reports share one creation service, status
model, and event history.

## Incident fields

Each record includes a UUID `incidentId`, title, description, `applicationId` and `applicationName`,
severity, status, source, reporter (when supplied), created/updated/detection timestamps, optional
assignee and investigation summary, recovery status, optional resolution timestamp, and a
chronological timeline.

Supported sources:

- `monitoring`: created after the configured consecutive failure threshold. It includes the latest
  health evidence and updates the active incident during the same outage.
- `manual_dashboard`: submitted through the dashboard report form.
- `team_report`: a simulated report entered through the dashboard. It stores reporter information
  and the original message, platform, channel/conversation reference, and original message timestamp.

Reports are not merged based on title similarity. A teammate message can instead be explicitly
linked to an existing incident.

## API

All backend paths are under `/api/v1`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/incidents` | Create a `manual_dashboard` or `team_report` incident |
| `GET` | `/incidents` | List incidents; filter with `status`, `source`, `severity`, `applicationId`, `active`, and `limit` |
| `GET` | `/incidents/:incidentId` | Retrieve incident details |
| `PATCH` | `/incidents/:incidentId` | Update status, assignee, or investigation summary |
| `GET` | `/incidents/:incidentId/history` | Retrieve chronological timeline events |
| `POST` | `/incidents/:incidentId/reports` | Attach a teammate report to an existing incident |

The dashboard exposes matching same-origin proxies under `/api/incidents`. Creation requests are
validated by the shared incident service. Status changes are transition-checked and appended to the
timeline. `resolved` is rejected unless recovery status is `verified`; monitoring performs that
verification using successful health checks.

## Authentication limitation

There is no dashboard user authentication or authorization system in the existing project. Therefore
the dashboard's reporter name is user-supplied and unverified, and incident write endpoints are not
protected by user identity. The UI states this explicitly. Do not expose these write endpoints to an
untrusted network until authentication and authorization are added. Monitoring ingestion remains
protected by its separate bearer token.

## Testing

`npm test` covers monitoring-created incidents, dashboard/team report creation, report linking,
history ordering, query filters, guarded status transitions, and the Mongo repository's behavior
when a concurrent status update no longer matches its expected state.
