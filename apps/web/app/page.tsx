import { AuditForm } from "../components/AuditForm";
import strip from "../data/proof-strip.json";

export default function Page() {
  return (
    <main>
      <h1>Glassbox</h1>
      <p className="strip">{strip.totals.sentence}</p>
      <p className="hint">{strip.note}</p>
      {strip.attribution.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p>
        <a href="/proof-strip.html">Account list</a>
        {" · "}
        Mainnet examples: reflect-adam-mainnet-agent-contract.near and ironshield.near. Testnet example:
        ac-sandbox.votron.testnet. ironshield.near is a Shade v2 interface in the saved index. That row loaded
        no registration quote and no approved measurements. Those checks stay not proven.
      </p>
      <p>Read-only audit of a NEAR agent account, or of a pasted registration, app compose, or deployment JSON.</p>
      <p>The ladder is PROVEN, NOT PROVEN, or RISKY. It describes the registered configuration. It does not judge payments.</p>
      <AuditForm />
    </main>
  );
}
