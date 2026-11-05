export interface EvidenceLink {
  label: string;
  url?: string;
  detail?: string;
}

export interface Finding {
  id: string;
  ladder: "PROVEN" | "NOT_PROVEN" | "RISKY";
  title: string;
  plainEnglish: string;
  inference: boolean;
  evidence: EvidenceLink[];
}

export interface ApprovalEvent {
  method: string;
  kind: "approve" | "remove";
  txHash: string;
  signer: string;
  timestampIso?: string;
  success: boolean;
  detail: string;
}

export interface AuditPayload {
  overall: Finding["ladder"];
  summary: string;
  report: {
    target: string;
    network: string;
    shade: string;
    summary: { proven: number; notProven: number; risky: number };
    findings: Finding[];
    approvalHistory: ApprovalEvent[];
    approvalHistoryNote?: string;
    attribution: string[];
    limitations: string[];
    verifier?: {
      package: string;
      version: string;
      qeIdentity: string;
      tcbStatus: string;
      pccsAllowlist: string[];
    };
    threatModel?: string;
  };
}

const ORDER: Finding["ladder"][] = ["RISKY", "NOT_PROVEN", "PROVEN"];

export function Ladder({ payload }: { payload: AuditPayload }) {
  const { report } = payload;
  return (
    <section>
      <p>
        <strong>{report.target}</strong> · {report.network} · {report.shade}
      </p>
      <p>{payload.summary}</p>
      {report.verifier ? (
        <p>
          Verifier {report.verifier.package} {report.verifier.version}. QE identity {report.verifier.qeIdentity}. TCB
          status {report.verifier.tcbStatus}. PCCS allowlist: {report.verifier.pccsAllowlist.join(", ")}.
        </p>
      ) : null}
      {report.threatModel ? <p>{report.threatModel}</p> : null}
      {ORDER.map((rung) => {
        const group = report.findings.filter((finding) => finding.ladder === rung);
        if (group.length === 0) return null;
        return (
          <div className="rung" key={rung}>
            <h2>{rung.replace("_", " ")}</h2>
            {group.map((finding) => (
              <article key={finding.id}>
                <h3>{finding.title}</h3>
                <p>{finding.plainEnglish}</p>
                {finding.inference ? <p className="inference">Marked as an inference.</p> : null}
                {finding.evidence.length > 0 ? (
                  <ul className="evidence">
                    {finding.evidence.map((item) => (
                      <li key={`${finding.id}-${item.label}-${item.detail ?? ""}`}>
                        {item.url ? <a href={item.url}>{item.label}</a> : item.label}
                        {item.detail ? ` — ${item.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        );
      })}
      <div className="rung">
        <h2>APPROVAL HISTORY</h2>
        <p>On-demand approve and remove calls for this contract. Not a continuous watcher.</p>
        {report.approvalHistoryNote ? <p>{report.approvalHistoryNote}</p> : null}
        {report.approvalHistory.length === 0 ? <p>No approve or remove calls were loaded.</p> : null}
        <ul className="history">
          {report.approvalHistory.map((event) => (
            <li key={event.txHash + event.method}>
              {event.timestampIso ?? "time unknown"} {event.method} by {event.signer} ({event.success ? "success" : "failed"}) — {event.detail}
            </li>
          ))}
        </ul>
      </div>
      {report.attribution.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <ul>
        {report.limitations.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
