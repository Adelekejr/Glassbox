import { AuditForm } from "../components/AuditForm";

export default function Page() {
  return (
    <main>
      <h1>Glassbox</h1>
      <p>Read-only audit of a NEAR agent account, or of a pasted registration, app compose, or deployment JSON.</p>
      <p>The ladder is PROVEN, NOT PROVEN, or RISKY. It describes the registered configuration. It does not judge payments.</p>
      <AuditForm />
    </main>
  );
}
