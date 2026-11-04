import ServiceOverview from "../components/service-overview.jsx";
import { SERVICE_CATALOG } from "../lib/service-catalog.js";
import { getHealthReport } from "../lib/health-checks.js";

export const dynamic = "force-dynamic";

function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32" fill="none">
      <path d="M16 3.5 27 8v7.7c0 6.3-4.5 10.6-11 13.3C9.5 26.3 5 22 5 15.7V8l11-4.5Z" />
      <path d="M8.7 16h4l2-4.2 3.1 8.5 2.1-4.3h3.4" />
    </svg>
  );
}

export default async function HomePage() {
  const initialReport = await getHealthReport();

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="On-call Incident Assistant home">
          <BrandMark />
          <span>On-call<br />Incident Assistant</span>
        </a>

        <div className="workspace-label">Workspace</div>
        <nav>
          <a className="nav-link nav-link-active" href="/" aria-current="page">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path d="M3 5.5h14M3 10h14M3 14.5h9" />
            </svg>
            <span>Overview</span>
          </a>
        </nav>

        <div className="sidebar-foot">
          <span className="scope-mark" aria-hidden="true" />
          <span>Local workspace</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <span>Local workspace</span>
          <span className="stage-label">Scaffold · Prompt 1</span>
        </header>

        <div className="work-sheet">
          <section className="page-heading" aria-labelledby="page-title">
            <div>
              <h1 id="page-title">Service health</h1>
              <p className="page-subtitle">
                Reachability checks for the services in this scaffold.
              </p>
            </div>
            <a className="api-link" href="/api/health" target="_blank" rel="noreferrer">
              Dashboard health
            </a>
          </section>

          <ServiceOverview services={SERVICE_CATALOG} initialReport={initialReport} />

          <section className="scope-section" aria-labelledby="scope-heading">
            <div className="scope-section-heading">
              <h2 id="scope-heading">What these checks cover</h2>
              <p>Read the status as process reachability, not application readiness.</p>
            </div>
            <div className="scope-grid">
              <article>
                <h3>Process</h3>
                <p>A healthy row means its `/health` endpoint returned the expected service identity.</p>
              </article>
              <article>
                <h3>Response</h3>
                <p>Round-trip time is measured for this page load or your latest manual refresh.</p>
              </article>
              <article>
                <h3>Dependencies</h3>
                <p>Database readiness, scheduled monitoring, incidents, AI triage and recovery are not active yet.</p>
              </article>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
