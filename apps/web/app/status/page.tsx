import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";
import { HEALTH_WORKFLOW_URL, formatCheckedAt, loadHealthStatus } from "../../lib/health-status";

export const revalidate = 600;

export const metadata = { title: "Status · Glassbox" };

const PLANNED = [
  "Audit ac-sandbox.votron.testnet",
  "Audit ironshield.near",
  "NearBlocks history API",
];

export default async function StatusPage() {
  const status = await loadHealthStatus();
  return (
    <>
      <SiteHeader current="Status" />
      <main id="main">
        <section className="page-head" aria-labelledby="page-title">
          <div className="wrap">
            <div className="eyebrow">
              <span className="tick" aria-hidden="true" />
              <span className="label">Daily check</span>
            </div>
            <h1 id="page-title">Status</h1>
            <p className="note">
              A public job checks the live audit once a day. This page reads that result. If the result cannot be read, the status stays unknown. Unknown is not a pass.
            </p>
          </div>
        </section>
        <section aria-label="Health checks" style={{ paddingBottom: 96 }}>
          <div className="wrap">
            <p className="health-status" data-state={status.state} style={{ textDecoration: "none" }}>
              <span className="health-dot" aria-hidden="true" />
              <span>{status.label}</span>
              <span className="health-time">{status.checkedLabel}</span>
            </p>
            {status.state === "unknown" ? (
              <ul className="status-list">
                {PLANNED.map((name) => (
                  <li key={name} className="status-row" data-state="unknown">
                    <span className="health-dot" aria-hidden="true" />
                    <div>
                      <h3>{name}</h3>
                      <p>Not recorded. No result was read for this check.</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="status-list">
                {status.checks.map((check) => (
                  <li key={check.id} className="status-row" data-state={check.ok ? "passing" : "failing"}>
                    <span className="health-dot" aria-hidden="true" />
                    <div>
                      <h3>{check.name}</h3>
                      <p>{check.ok ? "Passed" : "Failed"} · Last checked {formatCheckedAt(check.checkedAt)}</p>
                      <p>{check.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="status-links">
              {status.runUrl ? <a href={status.runUrl}>This workflow run</a> : <span>No workflow run is recorded yet.</span>}
              <a href={HEALTH_WORKFLOW_URL}>Daily health workflow</a>
            </div>
            <p className="note" style={{ marginTop: 24 }}>
              The page reads a public file on the status branch of the Glassbox repository. The browser is not given a token.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
