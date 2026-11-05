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
        incidents.createIndex({ sourceEventId: 1 }, { unique: true, sparse: true }),
        incidents.createIndex({ activeApplicationId: 1 }, { unique: true, sparse: true }),
        incidents.createIndex({ status: 1, createdAt: -1 }),
        incidents.createIndex({ source: 1, severity: 1, createdAt: -1 }),
        incidents.createIndex({ isActive: 1, updatedAt: -1 }),
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
      return withoutMongoId(await incidents.findOne({
        activeApplicationId: applicationId,
        source: "monitoring",
      }));
    },

    async findIncidentBySourceEventId(sourceEventId) {
      return withoutMongoId(await incidents.findOne({ sourceEventId }));
    },

    async createIncident(incident) {
      await incidents.insertOne(incident);
      return incident;
    },

    async updateIncident(
      incidentId,
      changes,
      {
        clearActiveApplicationId = false,
        event = null,
        expectedStatus = null,
      } = {},
    ) {
      const update = { $set: changes };
      if (clearActiveApplicationId) {
        update.$unset = { activeApplicationId: "" };
      }
      if (event) update.$addToSet = { timeline: event };
      const filter = { incidentId };
      if (expectedStatus) filter.status = expectedStatus;
      const result = await incidents.updateOne(filter, update);
      if (result.matchedCount === 0) return null;
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async appendIncidentEvent(incidentId, event) {
      await incidents.updateOne(
        { incidentId },
        {
          $set: { updatedAt: event.timestamp },
          $addToSet: { timeline: event },
        },
      );
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async claimInvestigation(incidentId, {
      attemptId,
      startedAt,
      staleBefore,
      event,
    }) {
      const result = await incidents.updateOne(
        {
          incidentId,
          status: { $in: ["open", "investigating", "awaiting_approval", "failed"] },
          $or: [
            { "investigation.status": { $ne: "running" } },
            { "investigation.startedAt": { $lt: staleBefore } },
          ],
        },
        {
          $set: {
            status: "investigating",
            isActive: true,
            updatedAt: startedAt,
            "investigation.status": "running",
            "investigation.attemptId": attemptId,
            "investigation.startedAt": startedAt,
            "investigation.error": null,
          },
          $inc: { "investigation.attemptCount": 1 },
          $addToSet: { timeline: event },
        },
      );
      if (result.matchedCount !== 1) return null;
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async completeInvestigation(incidentId, {
      attemptId,
      completedAt,
      diagnosis,
      event,
    }) {
      const result = await incidents.updateOne(
        {
          incidentId,
          "investigation.status": "running",
          "investigation.attemptId": attemptId,
        },
        {
          $set: {
            updatedAt: completedAt,
            "investigation.status": "completed",
            "investigation.completedAt": completedAt,
            "investigation.diagnosis": diagnosis,
            "investigation.error": null,
          },
          $addToSet: { timeline: event },
        },
      );
      if (result.matchedCount !== 1) return null;
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async failInvestigation(incidentId, {
      attemptId,
      failedAt,
      failure,
      event,
    }) {
      const result = await incidents.updateOne(
        {
          incidentId,
          "investigation.status": "running",
          "investigation.attemptId": attemptId,
        },
        {
          $set: {
            updatedAt: failedAt,
            "investigation.status": "failed",
            "investigation.failedAt": failedAt,
            "investigation.error": failure,
          },
          $addToSet: { timeline: event },
        },
      );
      if (result.matchedCount !== 1) return null;
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async addLinkedReport(incidentId, report, event) {
      await incidents.updateOne(
        { incidentId },
        {
          $set: { updatedAt: event.timestamp },
          $addToSet: {
            reports: report,
            timeline: event,
          },
        },
      );
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async findIncident(incidentId) {
      return withoutMongoId(await incidents.findOne({ incidentId }));
    },

    async listIncidents({
      active = false,
      status = null,
      source = null,
      severity = null,
      applicationId = null,
      limit = 50,
    } = {}) {
      const query = {};
      if (active) {
        query.$or = [
          { isActive: true },
          { activeApplicationId: { $exists: true } },
        ];
      }
      if (status) query.status = Array.isArray(status) ? { $in: status } : status;
      if (source) query.source = Array.isArray(source) ? { $in: source } : source;
      if (severity) {
        query.severity = Array.isArray(severity) ? { $in: severity } : severity;
      }
      if (applicationId) query.applicationId = applicationId;

      const documents = await incidents
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return documents.map(withoutMongoId);
    },
  });
}
