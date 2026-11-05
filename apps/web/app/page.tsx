import { AuditWorkspace } from "../components/AuditWorkspace";
import { ProofStrip } from "../components/ProofStrip";
import { Reveal } from "../components/Reveal";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { Surfaces } from "../components/Surfaces";

function Intro() {
  return (
    <>
      <div className="eyebrow reveal">
        <span className="tick" aria-hidden="true" />
        <span className="label">NEAR Hackathon · Security track</span>
      </div>
      <h1 id="hero-title" className="reveal">
        What was registered for this agent, <span className="dim">and what can change it.</span>
      </h1>
      <p className="lede reveal">
        <strong>Free, open-source (MIT) public auditor for AI-agent contracts on NEAR.</strong> Read-only audit of a
        NEAR agent account, or of a pasted registration, app compose, or deployment JSON. The ladder is{" "}
        <span className="rung-inline p">PROVEN</span>, <span className="rung-inline n">NOT PROVEN</span>, or{" "}
        <span className="rung-inline r">RISKY</span>. It describes the registered configuration. It does not judge
        payments.
      </p>
    </>
  );
}

function SecHead({ n, kicker, id, title, children }: { n: string; kicker: string; id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="sec-head">
      <div>
        <div className="idx label"><span className="n">{n}</span><span>{kicker}</span></div>
        <h2 id={id} className="reveal">{title}</h2>
      </div>
      <p className="reveal">{children}</p>
    </div>
  );
}

const STEPS: { title: React.ReactNode; body: React.ReactNode }[] = [
  { title: "Paste an account or a file.", body: "A live account id is read from NEAR. JSON pasted on this page is the text in the form. A CLI local file is read on your computer when you pass a path to glassbox. This page does not read local files." },
  { title: "Network from the suffix.", body: <><code>.testnet</code> is testnet. <code>.near</code> is mainnet. Anything else is tried on mainnet, then testnet.</> },
  { title: "Fetch the registration evidence.", body: <>Glassbox looks up <code>register_agent</code> (or <code>register_worker</code>) and reads the arguments. It does not write to the chain.</> },
  { title: "Verify the quote.", body: <><code>@phala/dcap-qvl</code> checks the signature. Fresh collateral comes only from the PCCS allowlist. A caller cannot choose that host.</> },
  { title: "Compose hygiene.", body: "Image pins, public logs, secret-looking names, sockets, and the dstack image comparison. Values of secrets are not printed." },
  { title: "Access keys and contract checks.", body: <>Who holds a full-access key, who can call <code>approve_codehash</code> or <code>approve_measurements</code>, whether <code>remove_codehash</code> or <code>remove_measurements</code> shows up, and whether the contract code hash matches a known Shade template. Missing evidence stays <strong>NOT PROVEN</strong>.</> },
  { title: "Ladder report.", body: <>Each finding is PROVEN, NOT PROVEN, or RISKY. The report includes a threat-model paragraph: a valid quote is a TDX-attested registered configuration, not proof of an honest operator. It also states the registration time, how old that attestation is, and <code>valid_until_ms</code> when a Shade v2 view sent one. Those checks are proven at registration only. A registration is not a live process. By default Glassbox does not call a guest agent. Phala blocks those routes, so live observation stays <strong>NOT PROVEN</strong>.</> },
  { title: <>Optional <code>--sign</code> / <code>verify</code>.</>, body: <><code>--sign</code> writes a hash and a local signature. <code>verify</code> checks those and re-reads the registration. <code>--anchor</code> only records that you asked to publish the hash later. It does not send a transaction.</> },
];

const RUNGS = [
  { k: "PROVEN", name: "PROVEN", text: "A direct check succeeded: a signature verified, two hashes were equal, or a view returned the value named in the sentence." },
  { k: "NOT_PROVEN", name: "NOT PROVEN", text: "The evidence was missing, the index may be incomplete, or the question is outside what a registration can show. This is not a pass." },
  { k: "RISKY", name: "RISKY", text: "The registered configuration, or the account's keys, matched a concrete risk named in the sentence." },
];

const TOOLS = [
  { title: "Signed reports", body: <><code>--sign</code> writes a hash and a local signature. <code>verify</code> checks those and re-reads the registration. <code>--offline</code> checks the hash and signature only.</>, cmd: "node packages/cli/bin/glassbox.js packages/core/test/fixtures/votron-registration.json --sign --out report.json\nnode packages/cli/bin/glassbox.js verify report.json --offline" },
  { title: "Diff", body: <><code>glassbox diff</code> compares two accounts or two JSON files and says what changed in the compose, the measurements, the codehash, and the findings.</>, cmd: "node packages/cli/bin/glassbox.js diff fixtures/compose/pinned.json fixtures/compose/loose.json" },
  { title: "Compose check", body: <>The Action runs <code>glassbox check fixtures/compose/pinned.json --fail-on risky</code>. The job fails when the audit has a risky finding.</>, cmd: "node packages/cli/bin/glassbox.js check fixtures/compose/pinned.json --fail-on risky" },
];

export default function Page() {
  return (
    <>
      <SiteHeader current="Audit" />
      <main id="main">
        <AuditWorkspace intro={<Intro />} strip={<ProofStrip />} />

        <section className="section" id="ladder" aria-labelledby="ladder-title">
          <div className="wrap">
            <SecHead n="02" kicker="The ladder" id="ladder-title" title="What the ladder means">
              The report also names the highest rung already on the ladder. That line is not a separate check. The counts stay the table of contents.
            </SecHead>
            <div className="rungs">
              {RUNGS.map((r) => (
                <div key={r.k} className={`rung-row ${r.k} reveal`}>
                  <div className="rung-name"><span className={`glyph lg ${r.k}`} aria-hidden="true" />{r.name}</div>
                  <div><p>{r.text}</p></div>
                </div>
              ))}
            </div>
            <div className="threat reveal">
              <div>
                <span className="label">Threat model · printed in every report</span>
                <p className="src">TEE.fail showed that physical access to DDR5 memory can forge TDX quotes, including quotes that carry a dstack context. See <a href="https://tee.fail/">https://tee.fail/</a>.</p>
              </div>
              <blockquote>A valid Intel TDX quote proves a TDX-attested registered configuration. It does not prove an honest operator.</blockquote>
            </div>
          </div>
        </section>

        <section className="section" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <SecHead n="03" kicker="Pipeline" id="how-title" title="How Glassbox works">
              Glassbox answers one question: what was registered for this agent, and what can change it. It does not watch the guest, and it does not send a transaction.
            </SecHead>
            <div className="flow reveal" tabIndex={0} aria-label="Pipeline">
              account or file<b>→</b>network from the suffix<b>→</b>register_agent evidence<b>→</b>quote check (dcap-qvl + PCCS allowlist)<b>→</b>compose hygiene<b>→</b>access keys and contract checks<b>→</b>ladder report<b>→</b>optional --sign / verify
            </div>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={i} className="reveal"><h3>{s.title}</h3><p>{s.body}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" id="surfaces" aria-labelledby="surfaces-title">
          <div className="wrap">
            <SecHead n="04" kicker="Surfaces" id="surfaces-title" title="You can ask in three places.">
              The command line is <code>glassbox</code>. An agent tool is MCP <code>check_agent</code>. This page is the web form, and it is deployed.
            </SecHead>
            <Surfaces />
          </div>
        </section>

        <section className="section" id="tools" aria-labelledby="tools-title">
          <div className="wrap">
            <SecHead n="05" kicker="Beyond one report" id="tools-title" title="Sign it. Diff it. Gate it in CI.">
              None of these send a transaction.
            </SecHead>
            <div className="tools">
              {TOOLS.map((t) => (
                <div key={t.title} className="tool reveal">
                  <h3>{t.title}</h3>
                  <div><p>{t.body}</p><div className="cmd">{t.cmd}</div></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <Reveal />
    </>
  );
}
