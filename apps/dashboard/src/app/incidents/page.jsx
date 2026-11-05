import DashboardShell from "../../components/dashboard-shell.jsx";
import IncidentList from "../../components/incident-list.jsx";
import {
  getIncidents,
  getMonitoringStatus,
} from "../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const [incidentResult, monitoringResult] = await Promise.allSettled([
    getIncidents(),
    getMonitoringStatus(),
  ]);
  const incidentsAvailable =
    incidentResult.status === "fulfilled" &&
    Array.isArray(incidentResult.value?.incidents);
  const monitoringAvailable =
    monitoringResult.status === "fulfilled" &&
    typeof monitoringResult.value?.application === "object";

  return (
    <DashboardShell
      activeNav="incidents"
      title="Incidents"
      subtitle="Automatic alerts and reports from the team, kept in one incident history."
    >
      <IncidentList
        initialIncidents={incidentsAvailable ? incidentResult.value.incidents : []}
        initialError={!incidentsAvailable}
        application={monitoringAvailable ? monitoringResult.value.application : null}
      />
    </DashboardShell>
  );
}
