import { MongoClient } from "mongodb";

export function createMongoReadiness({
  uri,
  logger,
  MongoClientClass = MongoClient,
  serverSelectionTimeoutMS = 2000,
} = {}) {
  const client = new MongoClientClass(uri, { serverSelectionTimeoutMS });

  return Object.freeze({
    async check() {
      try {
        await client.db().command({ ping: 1 });
        return "ok";
      } catch (error) {
        logger.warn("mongodb_readiness_failed", {
          errorName: error?.name || "Error",
        });
        return "unavailable";
      }
    },
    close() {
      return client.close();
    },
  });
}

