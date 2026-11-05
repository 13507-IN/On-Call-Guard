import ServiceOverview from "../components/service-overview.jsx";
import MonitoringOverview from "../components/monitoring-overview.jsx";
import DashboardShell from "../components/dashboard-shell.jsx";
import { SERVICE_CATALOG } from "../lib/service-catalog.js";
import { getHealthReport } from "../lib/health-checks.js";
import { getDashboardMonitoringData } from "../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [initialReport, initialMonitoringData] = await Promise.all([
    getHealthReport(),
    getDashboardMonitoringData(),
  ]);
  const initialUpdatedAt =
    initialMonitoringData.monitoringAvailable || initialMonitoringData.incidentsAvailable
      ? new Date().toISOString()
      : null;

  return (
    <DashboardShell
      activeNav="overview"
      stageLabel="Monitoring · Prompt 4"
      title="Monitoring overview"
      subtitle="Independent health checks and active incidents for the demo application."
      action={
        <a className="api-link" href="/api/health" target="_blank" rel="noreferrer">
          Dashboard health
        </a>
      }
    >
      <MonitoringOverview
        initialMonitoring={initialMonitoringData.monitoring}
        initialIncidents={initialMonitoringData.incidents}
        initialMonitoringAvailable={initialMonitoringData.monitoringAvailable}
        initialIncidentsAvailable={initialMonitoringData.incidentsAvailable}
        initialUpdatedAt={initialUpdatedAt}
        initialError={initialMonitoringData.hasError}
      />

      <ServiceOverview services={SERVICE_CATALOG} initialReport={initialReport} />

      <section className="scope-section" aria-labelledby="scope-heading">
        <div className="scope-section-heading">
          <h2 id="scope-heading">What these checks cover</h2>
          <p>The demo app is monitored continuously; supporting processes are checked on demand.</p>
        </div>
        <div className="scope-grid">
          <article>
            <h3>Demo application</h3>
            <p>A healthy status means the app responds and MongoDB accepts a ping.</p>
          </article>
          <article>
            <h3>Response</h3>
            <p>Round-trip time is measured for this page load or your latest manual refresh.</p>
          </article>
          <article>
            <h3>Other services</h3>
            <p>The API, triage and executor entries report process reachability. The independent monitor reports its own readiness.</p>
          </article>
        </div>
      </section>
    </DashboardShell>
  );
}
