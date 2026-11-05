import strip from "../../data/proof-strip.json";
import { AccountsTable, type IndexRow } from "../../components/AccountsTable";
import { Reveal } from "../../components/Reveal";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteHeader } from "../../components/SiteHeader";

export const metadata = { title: "Account list · Glassbox" };

export default function AccountsPage() {
  const t = strip.totals;
  const totals: [number, string][] = [
    [t.scanned, "agents scanned"],
    [t.proven, "proven"],
    [t.vulnerableConfiguration, "match a vulnerable configuration"],
    [t.notProven, "not proven"],
  ];
  return (
    <>
      <SiteHeader current="Account list" />
      <main id="main">
        <section className="page-head" aria-labelledby="page-title">
          <div className="wrap">
            <div className="eyebrow reveal"><span className="tick" aria-hidden="true" /><span className="label">Saved live index · {strip.generatedAt}</span></div>
            <h1 id="page-title" className="reveal">Account list</h1>
            <p className="sentence reveal">{t.sentence}</p>
            <p className="note reveal">{strip.note}</p>
          </div>
        </section>
        <section aria-label="Totals and accounts" style={{ paddingBottom: 96 }}>
          <div className="wrap">
            <div className="totals reveal">
              {totals.map(([v, k]) => (
                <div key={k}><div className="v">{v}</div><div className="k">{k}</div></div>
              ))}
            </div>
            <AccountsTable rows={strip.rows as IndexRow[]} />
            <div className="legend">
              <span><i className="glyph RISKY" aria-hidden="true" />RISKY</span>
              <span><i className="glyph NOT_PROVEN" aria-hidden="true" />NOT PROVEN</span>
              <span><i className="glyph PROVEN" aria-hidden="true" />PROVEN</span>
              <span className="attribution">{strip.attribution.join(" ")}</span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <Reveal />
    </>
  );
}
