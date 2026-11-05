function withoutMongoId(document) {
  if (!document) return null;
  const { _id, ...record } = document;
  return record;
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

export function createMongoIncidentRepository(database) {
  const incidents = database.collection("incidents");
  const monitoringStates = database.collection("monitoring_state");
  const healthChecks = database.collection("health_checks");

  return Object.freeze({
    async initialize() {
      await Promise.all([
        incidents.createIndex({ incidentId: 1 }, { unique: true }),
        incidents.createIndex({ activeApplicationId: 1 }, { unique: true, sparse: true }),
        incidents.createIndex({ status: 1, createdAt: -1 }),
        healthChecks.createIndex({ checkId: 1 }, { unique: true }),
        healthChecks.createIndex({ applicationId: 1, checkedAt: -1 }),
        monitoringStates.createIndex({ applicationId: 1 }, { unique: true }),
      ]);
    },

    async insertCheck(check) {
      try {
        await healthChecks.insertOne(check);
        return true;
      } catch (error) {
        if (isDuplicateKey(error)) return false;
        throw error;
      }
    },

    async getMonitoringState(applicationId) {
      return withoutMongoId(await monitoringStates.findOne({ applicationId }));
    },

    async saveMonitoringState(state) {
      await monitoringStates.replaceOne(
        { applicationId: state.applicationId },
        state,
        { upsert: true },
      );
      return state;
    },

    async getRecentChecks(applicationId, limit = 10) {
      const documents = await healthChecks
        .find({ applicationId })
        .sort({ checkedAt: -1 })
        .limit(limit)
        .toArray();
      return documents.map(withoutMongoId);
    },

    async getActiveIncident(applicationId) {
      return withoutMongoId(await incidents.findOne({ activeApplicationId: applicationId }));
    },

    async createIncident(incident) {
      await incidents.insertOne(incident);
      return incident;
    },

    async updateIncident(incidentId, changes, { clearActiveApplicationId = false } = {}) {
      const update = { $set: changes };
      if (clearActiveApplicationId) {
        update.$unset = { activeApplicationId: "" };
      }
      await incidents.updateOne({ incidentId }, update);
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async findIncident(incidentId) {
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async listIncidents({ active = false, status = null, limit = 50 } = {}) {
      const query = {};
      if (active) query.activeApplicationId = { $exists: true };
      if (status) query.status = Array.isArray(status) ? { $in: status } : status;

      const documents = await incidents
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return documents.map(withoutMongoId);
    },
  });
}
