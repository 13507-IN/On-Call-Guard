import { createHash, timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;
const REPORTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

function parseReporterIdentity(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["id", "name"].includes(key))
  ) {
    throw new Error("Each team reporter token must map to an id and name.");
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!REPORTER_ID_PATTERN.test(id) || name.length < 1 || name.length > 120) {
    throw new Error("Each team reporter token must map to a valid id and name.");
  }

  return Object.freeze({ id, name });
}

export function parseTeamReporterCredentials(serializedCredentials) {
  if (
    serializedCredentials === undefined ||
    serializedCredentials === null
  ) {
    return [];
  }
  if (typeof serializedCredentials !== "string") {
    throw new Error("TEAM_REPORTER_TOKENS must be a JSON string.");
  }
  if (
    serializedCredentials.trim() === ""
  ) {
    return [];
  }

  let configured;
  try {
    configured = JSON.parse(serializedCredentials);
  } catch {
    throw new Error("TEAM_REPORTER_TOKENS must contain valid JSON.");
  }
  if (
    !configured ||
    typeof configured !== "object" ||
    Array.isArray(configured) ||
    Object.keys(configured).length > 100
  ) {
    throw new Error("TEAM_REPORTER_TOKENS must be an object with at most 100 entries.");
  }

  const seenDigests = new Set();
  return Object.entries(configured).map(([token, identity]) => {
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error("Each team reporter token must be 32–256 URL-safe characters.");
    }
    const digest = hashToken(token);
    const digestKey = digest.toString("hex");
    if (seenDigests.has(digestKey)) {
      throw new Error("TEAM_REPORTER_TOKENS contains a duplicate token.");
    }
    seenDigests.add(digestKey);

    return Object.freeze({
      digest,
      reporter: parseReporterIdentity(identity),
    });
  });
}

export function authenticateTeamReporter(authorization, credentials = []) {
  const match =
    typeof authorization === "string"
      ? /^Bearer ([A-Za-z0-9._~-]{32,256})$/i.exec(authorization)
      : null;
  if (!match) return null;

  const candidateDigest = hashToken(match[1]);
  let authenticatedReporter = null;
  for (const credential of credentials) {
    if (
      credential?.digest?.length === candidateDigest.length &&
      timingSafeEqual(candidateDigest, credential.digest)
    ) {
      authenticatedReporter = credential.reporter;
    }
  }

  return authenticatedReporter ? { ...authenticatedReporter } : null;
}
