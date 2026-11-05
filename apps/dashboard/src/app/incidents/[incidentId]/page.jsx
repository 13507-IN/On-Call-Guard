import { notFound } from "next/navigation";
import DashboardShell from "../../../components/dashboard-shell.jsx";
import IncidentDetail from "../../../components/incident-detail.jsx";
import { requestIncidentApi } from "../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function IncidentDetailsPage({ params }) {
  const { incidentId } = await params;
  if (!UUID_PATTERN.test(incidentId)) notFound();

  const [incidentResult, historyResult] = await Promise.allSettled([
    requestIncidentApi(`incidents/${encodeURIComponent(incidentId)}`),
    requestIncidentApi(`incidents/${encodeURIComponent(incidentId)}/history`),
  ]);
  if (incidentResult.status === "fulfilled" && incidentResult.value.status === 404) {
    notFound();
  }

  const incidentPayload = incidentResult.status === "fulfilled"
    ? incidentResult.value.payload
    : null;
  const historyPayload = historyResult.status === "fulfilled"
    ? historyResult.value.payload
    : null;
  const incident =
    incidentResult.status === "fulfilled" &&
    incidentResult.value.status >= 200 &&
    incidentResult.value.status < 300
      ? incidentPayload.incident
      : null;
  const events =
    historyResult.status === "fulfilled" &&
    historyResult.value.status >= 200 &&
    historyResult.value.status < 300 &&
    Array.isArray(historyPayload.events)
      ? historyPayload.events
      : [];

  return (
    <DashboardShell
      activeNav="incidents"
      title={incident?.title ?? "Incident details"}
      subtitle={incident ? `${incident.applicationName} · ${incident.incidentId}` : "Incident details could not be loaded."}
    >
      <IncidentDetail
        incidentId={incidentId}
        initialIncident={incident}
        initialEvents={events}
        initialError={!incident}
        initialHistoryError={!historyPayload?.events}
      />
    </DashboardShell>
  );
}
