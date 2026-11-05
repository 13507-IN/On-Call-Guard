import assert from "node:assert/strict";
import test from "node:test";
import { parseOncallCommand } from "../src/oncall-command.js";
import { formatIncidentReply } from "../src/incident-reply.js";

test("parses only the supported plain-text oncall command family", () => {
  assert.deepEqual(parseOncallCommand("  oncall report Website returns 500.  "), {
    kind: "command",
    action: "report",
    details: "Website returns 500.",
  });
  assert.equal(parseOncallCommand("other report something").kind, "not_oncall");
  assert.equal(parseOncallCommand("oncall recover incident").kind, "unknown");
  assert.equal(parseOncallCommand("oncall").kind, "help");
  assert.equal(parseOncallCommand(null).kind, "invalid");
});

test("formats saved diagnosis with uncertainty, evidence classes, and no recovery claim", () => {
  const message = formatIncidentReply({
    incident: {
      incidentId: "f94462bd-1b3d-4df6-a2a4-9bbd5f1c702a",
      investigation: { status: "completed" },
    },
    investigation: {
      diagnosis: {
        summary: "Requests are failing.",
        probableCause: "Database connectivity may be degraded.",
        confidence: 0.62,
        evidence: [
          {
            source: "health check",
            observation: "The database check failed.",
            classification: "confirmed_fact",
          },
          {
            source: "triage",
            observation: "The DB pool may be exhausted.",
            classification: "hypothesis",
          },
        ],
        recommendedAction: "Review the database connection pool.",
        requiresHumanApproval: true,
        risk: "Increasing the pool may increase database load.",
        recommendedInvestigationSteps: ["Check database connection metrics."],
        relevantLogExcerpts: [],
        missingInformation: ["Database logs are unavailable."],
      },
    },
    dashboardUrl: "https://ops.example/incidents/f94462bd-1b3d-4df6-a2a4-9bbd5f1c702a",
  });
  assert.match(message, /Probable cause \(not confirmed\)/);
  assert.match(message, /Confidence: 62%/);
  assert.match(message, /\[CONFIRMED\] health check/);
  assert.match(message, /\[HYPOTHESIS\] triage/);
  assert.match(message, /Approval required before recovery: Yes/);
  assert.match(message, /Recommended action \(advisory; not executed\)/);
  assert.match(message, /Relevant logs:\nNo relevant log excerpts available\./);
  assert.match(message, /Database logs are unavailable\./);
  assert.match(message, /Dashboard: https:\/\/ops\.example/);
});
