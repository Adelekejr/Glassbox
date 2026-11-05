import strip from "../data/proof-strip.json";

export function ProofStrip() {
  const t = strip.totals;
  return (
    <aside className="strip reveal" aria-labelledby="strip-title">
      <div className="strip-head">
        <span className="label" id="strip-title">Proof strip · saved live index</span>
        <a className="label" href="/accounts" style={{ color: "var(--link)" }}>Account list →</a>
      </div>
      <div className="big-stat">
        <span className="num">{t.vulnerableConfiguration}<small>/{t.scanned}</small></span>
        <span className="cap">agents match a vulnerable configuration</span>
      </div>
      <p className="strip-sentence">{t.sentence}</p>
      <ul className="strip-rows">
        {strip.rows.map((row) => (
          <li key={row.accountId}>
            <span className={`glyph ${row.bucket === "vulnerable-configuration" ? "RISKY" : "NOT_PROVEN"}`} aria-hidden="true" />
            <span className="acct" title={row.accountId}>{row.accountId}</span>
            <span className="cls" aria-label={`${row.summary.risky} risky, ${row.summary.notProven} not proven, ${row.summary.proven} proven`}>
              <span className="r">{row.summary.risky}</span> · <span className="n">{row.summary.notProven}</span> · <span className="p">{row.summary.proven}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="strip-note">{strip.note}</p>
      <div className="strip-foot">
        <span className="attribution">{strip.attribution.join(" ")}</span>
        <span className="label">{strip.generatedAt.slice(0, 16).replace("T", " ")} UTC</span>
      </div>
    </aside>
  );
}
