import { createIncidentService } from "./incident-service.js";

const MAX_INCIDENT_CHECKS = 20;

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
  idFactory,
  incidentService: sharedIncidentService,
}) {
  const incidentService = sharedIncidentService ?? createIncidentService({
    repository,
    clock,
    ...(idFactory ? { idFactory } : {}),
  });
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
          incident: await getActiveIncident(applicationId),
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
          const result = await incidentService.createIncident({
            applicationId,
            applicationName,
            title: `${applicationName} is unavailable`,
            description:
              `${applicationName} failed ${state.consecutiveFailures} consecutive health checks. ` +
              describeFailure(check),
            severity: "critical",
            source: "monitoring",
            startedAt: state.firstFailureAt ?? check.checkedAt,
            detectedAt: check.checkedAt,
            detectionTimestamp: check.checkedAt,
            lastObservedFailure: check,
            healthCheck: check,
            healthChecks: [check],
            failureCount: state.consecutiveFailures,
            lastProcessedCheckId: check.checkId,
          });
          incident = await repository.findIncident(result.incident.incidentId);
        }

        if (incident && incident.lastProcessedCheckId !== check.checkId) {
          incident = await incidentService.updateFromSystem(
            incident.incidentId,
            {
              lastObservedFailure: check,
              healthCheck: check,
              healthChecks: [...(incident.healthChecks ?? []), check].slice(-MAX_INCIDENT_CHECKS),
              failureCount: state.consecutiveFailures,
              lastProcessedCheckId: check.checkId,
            },
            {
              author: "monitor",
              eventType: "health_check_failed",
              message: describeFailure(check),
              metadata: {
                checkId: check.checkId,
                checkedAt: check.checkedAt,
                failureReason: check.failureReason,
                httpStatus: check.httpStatus,
                latencyMs: check.latencyMs,
                consecutiveFailures: state.consecutiveFailures,
              },
              timestamp: check.checkedAt,
            },
          );
        } else if (incident) {
          incident = await incidentService.getIncident(incident.incidentId);
        }
      } else if (!isFailure && incident) {
        if (state.consecutiveSuccesses >= policy.recoveryThreshold) {
          const resolvedAt = check.checkedAt;
          const startedAt = Date.parse(incident.startedAt ?? incident.detectedAt);
          incident = await incidentService.updateFromSystem(
            incident.incidentId,
            {
              status: "resolved",
              isActive: false,
              recoveryStatus: "verified",
              lastRecoveryCheck: check,
              resolvedAt,
              resolutionTimestamp: resolvedAt,
              recoveryCheck: check,
              outageDurationMs: Math.max(0, Date.parse(resolvedAt) - startedAt),
              lastProcessedCheckId: check.checkId,
            },
            {
              author: "monitor",
              eventType: "recovery_verified",
              message: `Application health verified by ${state.consecutiveSuccesses} consecutive successful checks.`,
              metadata: {
                checkId: check.checkId,
                checkedAt: check.checkedAt,
                consecutiveSuccessfulChecks: state.consecutiveSuccesses,
                recoveryThreshold: policy.recoveryThreshold,
              },
              timestamp: check.checkedAt,
            },
          );
        } else {
          incident = await incidentService.updateFromSystem(
            incident.incidentId,
            {
              recoveryStatus: "verifying",
              lastRecoveryCheck: check,
              lastProcessedCheckId: check.checkId,
            },
            {
              author: "monitor",
              eventType: "recovery_check_passed",
              message: "A successful health check was recorded while recovery is being verified.",
              metadata: {
                checkId: check.checkId,
                checkedAt: check.checkedAt,
                consecutiveSuccessfulChecks: state.consecutiveSuccesses,
                recoveryThreshold: policy.recoveryThreshold,
              },
              timestamp: check.checkedAt,
            },
          );
        }
      }

      return {
        duplicate: false,
        state,
        incident: incident
          ? await incidentService.getIncident(incident.incidentId)
          : null,
      };
    });
  }

  async function getActiveIncident(applicationId) {
    const incident = await repository.getActiveIncident(applicationId);
    return incident ? incidentService.getIncident(incident.incidentId) : null;
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
    return incidentService.listIncidents(options);
  }

  async function getIncident(incidentId) {
    return incidentService.getIncident(incidentId);
  }

  return Object.freeze({
    recordCheck,
    getMonitoringStatus,
    listIncidents,
    getIncident,
  });
}
