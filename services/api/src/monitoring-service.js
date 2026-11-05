import { randomUUID } from "node:crypto";
import { INCIDENT_STATUSES } from "@oncall/shared/monitoring";

const ACTIVE_STATUSES = new Set(INCIDENT_STATUSES.filter((status) => status !== "resolved"));
const MAX_INCIDENT_CHECKS = 20;

function publicIncident(incident) {
  if (!incident) return null;
  const {
    activeApplicationId,
    lastProcessedCheckId,
    ...visibleIncident
  } = incident;
  return visibleIncident;
}

function describeFailure(check) {
  if (check.failureReason === "http_status") {
    return `HTTP ${check.httpStatus} from the application's health endpoint.`;
  }
  if (check.failureReason === "timeout") return "The health endpoint timed out.";
  if (check.failureReason === "network_error") return "The application could not be reached.";
  return "The health endpoint returned an invalid response.";
}

export function createMonitoringService({
  repository,
  policy,
  clock = () => new Date(),
  idFactory = randomUUID,
}) {
  const pendingByApplication = new Map();

  function serialize(applicationId, operation) {
    const previous = pendingByApplication.get(applicationId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    pendingByApplication.set(applicationId, current);

    return previous
      .then(operation)
      .finally(() => {
        release();
        if (pendingByApplication.get(applicationId) === current) {
          pendingByApplication.delete(applicationId);
        }
      });
  }

  async function recordCheck(event) {
    return serialize(event.applicationId, async () => {
      const { applicationId, applicationName, check } = event;
      const persisted = await repository.insertCheck({
        applicationId,
        applicationName,
        ...check,
      });
      let state = await repository.getMonitoringState(applicationId);
      if (!persisted) {
        return {
          duplicate: true,
          state,
          incident: publicIncident(await repository.getActiveIncident(applicationId)),
        };
      }

      state ??= {
        applicationId,
        applicationName,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        firstFailureAt: null,
      };

      const isFailure = check.status === "unavailable";
      const previousFailureCount = state.consecutiveFailures ?? 0;
      const nextState = {
        ...state,
        applicationName,
        consecutiveFailures: isFailure ? previousFailureCount + 1 : 0,
        consecutiveSuccesses: isFailure ? 0 : (state.consecutiveSuccesses ?? 0) + 1,
        firstFailureAt: isFailure
          ? (previousFailureCount === 0 ? check.checkedAt : state.firstFailureAt)
          : null,
        latestCheck: check,
        lastCheckAt: check.checkedAt,
        lastProcessedCheckId: check.checkId,
        updatedAt: clock().toISOString(),
      };
      state = await repository.saveMonitoringState(nextState);

      let incident = await repository.getActiveIncident(applicationId);
      if (isFailure && state.consecutiveFailures >= policy.failureThreshold) {
        if (!incident) {
          const createdAt = clock().toISOString();
          const newIncident = {
            incidentId: idFactory(),
            applicationId,
            applicationName,
            title: `${applicationName} is unavailable`,
            description:
              `${applicationName} failed ${state.consecutiveFailures} consecutive health checks. ` +
              describeFailure(check),
            severity: "critical",
            status: "open",
            source: "monitoring",
            startedAt: state.firstFailureAt ?? check.checkedAt,
            detectedAt: check.checkedAt,
            lastObservedFailure: check,
            healthChecks: [check],
            failureCount: state.consecutiveFailures,
            activeApplicationId: applicationId,
            lastProcessedCheckId: check.checkId,
            createdAt,
            updatedAt: createdAt,
          };

          try {
            incident = await repository.createIncident(newIncident);
          } catch (error) {
            if (error?.code !== 11000) throw error;
            incident = await repository.getActiveIncident(applicationId);
          }
        }

        if (incident && incident.lastProcessedCheckId !== check.checkId) {
          const updatedAt = clock().toISOString();
          incident = await repository.updateIncident(incident.incidentId, {
            lastObservedFailure: check,
            healthChecks: [...(incident.healthChecks ?? []), check].slice(-MAX_INCIDENT_CHECKS),
            failureCount: state.consecutiveFailures,
            lastProcessedCheckId: check.checkId,
            updatedAt,
          });
        }
      } else if (
        !isFailure &&
        incident &&
        state.consecutiveSuccesses >= policy.recoveryThreshold
      ) {
        const resolvedAt = check.checkedAt;
        const startedAt = Date.parse(incident.startedAt ?? incident.detectedAt);
        incident = await repository.updateIncident(
          incident.incidentId,
          {
            status: "resolved",
            resolvedAt,
            recoveryCheck: check,
            outageDurationMs: Math.max(0, Date.parse(resolvedAt) - startedAt),
            lastProcessedCheckId: check.checkId,
            updatedAt: clock().toISOString(),
          },
          { clearActiveApplicationId: true },
        );
      }

      return {
        duplicate: false,
        state,
        incident: publicIncident(incident),
      };
    });
  }

  async function getMonitoringStatus(applicationId, applicationName) {
    const state = await repository.getMonitoringState(applicationId);
    const recentChecks = await repository.getRecentChecks(applicationId, 10);
    const now = clock().getTime();
    const lastCheckAt = state?.lastCheckAt ?? null;
    const ageMs = lastCheckAt === null ? null : Math.max(0, now - Date.parse(lastCheckAt));
    const staleAfterMs = policy.intervalMs * 2 + policy.timeoutMs;
    const status = lastCheckAt === null
      ? "starting"
      : ageMs <= staleAfterMs
        ? "active"
        : "stale";

    return {
      application: {
        id: applicationId,
        name: state?.applicationName ?? applicationName,
        status: status === "active" ? state?.latestCheck?.status ?? "unknown" : "unknown",
        latestCheck: state?.latestCheck ?? null,
        consecutiveFailedChecks: state?.consecutiveFailures ?? 0,
        consecutiveSuccessfulChecks: state?.consecutiveSuccesses ?? 0,
      },
      monitoring: {
        status,
        intervalMs: policy.intervalMs,
        timeoutMs: policy.timeoutMs,
        failureThreshold: policy.failureThreshold,
        recoveryThreshold: policy.recoveryThreshold,
        lastCheckAt,
        recentChecks,
      },
    };
  }

  async function listIncidents(options) {
    const incidents = await repository.listIncidents(options);
    return incidents.map(publicIncident);
  }

  async function getIncident(incidentId) {
    return publicIncident(await repository.findIncident(incidentId));
  }

  return Object.freeze({
    recordCheck,
    getMonitoringStatus,
    listIncidents,
    getIncident,
  });
}

export { ACTIVE_STATUSES };
