# Switch Console team communication

This repository provides an OpenCode `oncall` agent and a local MCP bridge to the existing
authenticated incident and investigation APIs. Switch Console starts the OpenCode session and
supplies its own Switch MCP tools and room skill. Use the Switch Console already installed on your
machine to connect the agent's rooms to Discord and Telegram. Switch owns the platform connection,
bot credentials, event delivery, and chat replies; this repository does not implement platform
webhooks or add a second chatbot transport.

## What works in the repository

- The restricted `oncall` OpenCode agent handles incident-related requests only.
- The local MCP bridge reads monitoring status/incidents and calls the unified teammate-report and
  investigation APIs. It has no recovery-execution tool.
- New Discord and Telegram reports preserve the original message, sender metadata when supplied,
  room reference, timestamp, and stable message event ID.
- The API namespaces event IDs by platform and stores them under its unique source-event index, so
  a redelivery returns the existing incident rather than creating another.
- New reports use the same incident creation and investigation services as dashboard and monitoring
  reports. Investigation results are returned by the agent to the current Switch chat.
- Findings are formatted from saved API data. Probable causes are labeled unconfirmed, and
  recommendations are advisory only.

## Configure the local project

1. Copy `.env.example` to `.env` for the application services and `switch.env.example` to
   `.env.switch` for the chat bridge. Set the bridge's `ONCALL_API_BASE_URL` and
   `ONCALL_DASHBOARD_BASE_URL` to addresses reachable by the local Switch/OpenCode process. The
   root `opencode.json` loads only `.env.switch` for the MCP child process.
2. Generate a private token of at least 32 characters. Set it as `ONCALL_API_TOKEN` in
   `.env.switch`, and add the same token to the API's `TEAM_REPORTER_TOKENS` mapping in `.env` with
   a service identity such as `{"id":"switch-oncall-agent","name":"Switch on-call agent"}`. Do not
   commit or post the token.
3. In Switch Console, use the OpenCode installation already present on the machine, select this
   repository as the agent workspace, and select the `oncall` agent. The local OpenCode version
   detected during setup is 1.19.4; the project config uses its V1 format.
4. Add/connect Discord and Telegram using the connector setup exposed by your Switch Console
   version. Keep bot tokens in Switch Console's secret/configuration store, not in this repository.
   Keep the Switch addressing policy limited to intended incident-response rooms and authorized
   people. Switch's default policy permits the owner and agents owned by that owner; grant the team
   only the access they need rather than widening access globally.
5. Start the app services with `npm run dev`, then verify the MCP server from the repository root
   with `opencode mcp list`. A successful live test requires the API, database, Switch connectors,
   and OpenCode provider to be available.

The agent understands ordinary text commands:

```text
oncall report Demo application: the website is returning 500 errors
oncall status <incident UUID>
oncall investigate <incident UUID>
oncall diagnosis <incident UUID>
oncall action <incident UUID>
oncall help
```

The agent also accepts a clear natural-language incident request. It asks which application is
affected when it cannot match the request to a registered app. Switch-delivered events include a
message ID and room context; the agent uses those for deduplication and posts its answer with
Switch's room-message tool, preserving a thread when present. It does not fabricate missing source
metadata. Discord/Telegram users should send ordinary chat text, not native slash commands.

## Security and limits

The API authenticates the MCP bridge with `ONCALL_API_TOKEN`. Its recorded `reporter` is therefore
the configured Switch agent service identity. The original platform sender is stored separately as
report attribution when Switch exposes it; this project does not independently verify the sender's
Discord/Telegram account or cryptographically validate Switch events. Configure access restrictions
in Switch Console and treat channel messages and pasted content as untrusted input.

No credentials, Switch accounts, bot connections, room permissions, or live deliveries were
configured by this repository change. Dashboard links are omitted when no valid dashboard base URL
is set. There is no automatic recovery execution.

Automated tests mock the incident API and cover Discord/Telegram report metadata, duplicate-event
handling, chat command parsing, saved diagnosis formatting, and safe API failures. They do not
connect to a live Switch Console, Discord server, Telegram bot, or deployed API; those connections
must be verified from your local Switch Console.
