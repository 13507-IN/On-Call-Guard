import assert from "node:assert/strict";
import test from "node:test";
import { parsePort } from "../src/port.js";

test("parsePort uses the configured default only when unset", () => {
  assert.equal(parsePort(undefined, "API_PORT", 4100), 4100);
  assert.equal(parsePort("", "API_PORT", 4100), 4100);
});

test("parsePort accepts valid port boundaries", () => {
  assert.equal(parsePort("1", "API_PORT", 4100), 1);
  assert.equal(parsePort("65535", "API_PORT", 4100), 65535);
});

test("parsePort rejects malformed and out-of-range values", () => {
  for (const value of ["0", "65536", "-1", "3.5", "abc", "1e3"]) {
    assert.throws(
      () => parsePort(value, "API_PORT", 4100),
      /API_PORT must be an integer between 1 and 65535/,
    );
  }
});
