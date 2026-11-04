const RELEASES = Object.freeze({
  healthy: Object.freeze({
    mode: "healthy",
    version: "1.0.0",
    releaseId: "demo-healthy-1.0.0",
  }),
  broken: Object.freeze({
    mode: "broken",
    version: "1.1.0",
    releaseId: "demo-broken-1.1.0",
  }),
});

const DEFAULT_MONGODB_URI = "mongodb://127.0.0.1:27017/oncall_demo?directConnection=true";
const BROKEN_MONGODB_URI =
  "mongodb://mongodb-unavailable.invalid:27017/oncall_demo?directConnection=true";

export function selectDemoRelease({
  mode = "healthy",
  mongodbUri = DEFAULT_MONGODB_URI,
} = {}) {
  if (!Object.hasOwn(RELEASES, mode)) {
    throw new Error('DEMO_APP_RELEASE must be either "healthy" or "broken".');
  }

  if (typeof mongodbUri !== "string" || mongodbUri.trim() === "") {
    throw new Error("MONGODB_URI must be a non-empty MongoDB connection string.");
  }

  const release = RELEASES[mode];
  return Object.freeze({
    ...release,
    mongodbUri: mode === "broken" ? BROKEN_MONGODB_URI : mongodbUri,
  });
}

