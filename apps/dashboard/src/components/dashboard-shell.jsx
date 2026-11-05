import Link from "next/link";

function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32" fill="none">
      <path d="M16 3.5 27 8v7.7c0 6.3-4.5 10.6-11 13.3C9.5 26.3 5 22 5 15.7V8l11-4.5Z" />
      <path d="M8.7 16h4l2-4.2 3.1 8.5 2.1-4.3h3.4" />
    </svg>
  );
}

export default function DashboardShell({
  activeNav = "overview",
  stageLabel = "Incident management · Prompt 4",
  title,
  subtitle,
  action = null,
  children,
}) {
  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand" href="/" aria-label="On-call Incident Assistant home">
          <BrandMark />
          <span>On-call<br />Incident Assistant</span>
        </Link>

        <div className="workspace-label">Workspace</div>
        <nav>
          <Link
            className={`nav-link${activeNav === "overview" ? " nav-link-active" : ""}`}
            href="/"
            aria-current={activeNav === "overview" ? "page" : undefined}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path d="M3 5.5h14M3 10h14M3 14.5h9" />
            </svg>
            <span>Overview</span>
          </Link>
          <Link
            className={`nav-link${activeNav === "incidents" ? " nav-link-active" : ""}`}
            href="/incidents"
            aria-current={activeNav === "incidents" ? "page" : undefined}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path d="M10 3.2 17 16H3L10 3.2Z" />
              <path d="M10 7.5v4.2m0 2.2v.1" />
            </svg>
            <span>Incidents</span>
          </Link>
        </nav>

        <div className="sidebar-foot">
          <span className="scope-mark" aria-hidden="true" />
          <span>Local workspace</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <span>Local workspace</span>
          <span className="stage-label">{stageLabel}</span>
        </header>

        <div className="work-sheet">
          <section className="page-heading" aria-labelledby="page-title">
            <div>
              <h1 id="page-title">{title}</h1>
              {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
            </div>
            {action}
          </section>
          {children}
        </div>
      </main>
    </div>
  );
}
