import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateTeamReporter,
  parseTeamReporterCredentials,
} from "../src/team-report-auth.js";

const token = "test-team-reporter-token-with-more-than-32-chars";
const reporter = { id: "user-17", name: "Sam" };

test("team reporter credentials resolve bearer tokens to configured identities", () => {
  const credentials = parseTeamReporterCredentials(JSON.stringify({ [token]: reporter }));

  assert.deepEqual(authenticateTeamReporter(`Bearer ${token}`, credentials), reporter);
  assert.deepEqual(authenticateTeamReporter(`bEaReR ${token}`, credentials), reporter);
  assert.equal(authenticateTeamReporter("Bearer incorrect-token", credentials), null);
  assert.equal(authenticateTeamReporter(null, credentials), null);
  assert.deepEqual(parseTeamReporterCredentials(undefined), []);
});

test("team reporter credential configuration rejects malformed tokens and identities", () => {
  assert.throws(
    () => parseTeamReporterCredentials("{"),
    /valid JSON/,
  );
  assert.throws(
    () => parseTeamReporterCredentials(JSON.stringify({ short: reporter })),
    /32–256/,
  );
  assert.throws(
    () => parseTeamReporterCredentials(JSON.stringify({
      [token]: { id: "user-17", name: "" },
    })),
    /valid id and name/,
  );
});
