"use client";

import { useState } from "react";
import { Caret } from "./Icons";
import { LadderBar } from "./LadderBar";

export interface EvidenceLink {
  label: string;
  url?: string;
  detail?: string;
}

export interface FindingProvenance {
  evidenceSource: "chain" | "file" | "paste" | "computed" | "unavailable";
  observationKind: "chain" | "file" | "paste" | "computed" | "unavailable";
  liveChain: boolean;
  label: string;
}

export interface Finding {
  id: string;
  ladder: "PROVEN" | "NOT_PROVEN" | "RISKY";
  lane?: "collateral-freshness";
  title: string;
  plainEnglish: string;
  inference: boolean;
  evidence: EvidenceLink[];
  provenance?: FindingProvenance;
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
    generatedAt?: string;
    summary: { proven: number; notProven: number; risky: number };
    plainSummary?: { text: string; whatToDo: string };
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

type Rung = Finding["ladder"];
const ORDER: Rung[] = ["RISKY", "NOT_PROVEN", "PROVEN"];
const LABEL: Record<Rung, string> = { RISKY: "RISKY", NOT_PROVEN: "NOT PROVEN", PROVEN: "PROVEN" };
const FILTER_LABEL: Record<Rung, string> = { RISKY: "Risky", NOT_PROVEN: "Not proven", PROVEN: "Proven" };

function provenanceTag(provenance: FindingProvenance): string {
  if (provenance.liveChain) return "Chain";
  if (provenance.observationKind === "unavailable") return "Unavailable";
  if (provenance.evidenceSource === "paste") return "Paste · not live chain";
  if (provenance.evidenceSource === "file") return "File · not live chain";
  if (provenance.observationKind === "computed") return "Computed · not live chain";
  return "Not live chain";
}

function isCollateralFreshness(finding: Finding): boolean {
  return finding.lane === "collateral-freshness" || finding.id === "tdx.fresh";
}

function breakable(url: string) {
  // Allow line breaks after "." and "/" so long hosts wrap cleanly in the narrow aside.
  return url.split(/(?<=[./])/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]));
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const bodyId = `f-${finding.id}`;
  return (
    <div className="finding" data-open={open}>
      <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        <span className={`glyph ${finding.ladder}`} aria-hidden="true" />
        <span>
          {finding.title}
          {finding.provenance ? <span className="tag">{provenanceTag(finding.provenance)}</span> : null}
          {finding.inference ? <span className="tag">Inference</span> : null}
        </span>
        <Caret className="caret" />
      </button>
      <div className="finding-body" id={bodyId} role="region" aria-label={finding.title}>
        <div>
          <div className="inner">
            <p>{finding.plainEnglish}</p>
            {finding.provenance ? (
              <p style={{ marginTop: 8, fontSize: ".875rem", color: "var(--text-3)" }}>{finding.provenance.label}</p>
            ) : null}
            {finding.inference ? (
              <p style={{ marginTop: 8, fontSize: ".875rem", color: "var(--text-3)" }}>Marked as an inference.</p>
            ) : null}
            {finding.evidence.length > 0 ? (
              <ul className="evidence">
                {finding.evidence.map((item) => (
                  <li key={`${finding.id}-${item.label}-${item.detail ?? ""}`}>
                    <span>{item.url ? <a href={item.url}>{item.label}</a> : item.label}</span>
                    {item.detail ? <span className="d">{item.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function RungGroup({ rung, findings }: { rung: Rung; findings: Finding[] }) {
  const collapsible = rung === "PROVEN" && findings.length > 4;
  const [collapsed, setCollapsed] = useState(collapsible);
  return (
    <div className="rung-group" data-rung={rung} data-collapsed={collapsible ? collapsed : undefined}>
      <div className="rung-title">
        <span className={`glyph ${rung}`} aria-hidden="true" />
        <span className="label">
          {LABEL[rung]} · {findings.length}
        </span>
      </div>
      {findings.map((finding) => (
        <FindingRow key={finding.id} finding={finding} />
      ))}
      {collapsible ? (
        <button className="more" type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <span>{collapsed ? `Show all ${findings.length} proven findings` : "Show fewer"}</span>
          <Caret className="caret" />
        </button>
      ) : null}
    </div>
  );
}

function LaneGroup({ findings }: { findings: Finding[] }) {
  const status = findings[0]?.ladder ?? "NOT_PROVEN";
  return (
    <div className="rung-group" data-lane="collateral-freshness">
      <div className="rung-title">
        <span className={`glyph ${status}`} aria-hidden="true" />
        <span className="label">Collateral freshness · {findings.length}</span>
      </div>
      {findings.map((finding) => (
        <FindingRow key={finding.id} finding={finding} />
      ))}
    </div>
  );
}

export function Ladder({ payload }: { payload: AuditPayload }) {
  const { report } = payload;
  const s = report.summary;
  const [filter, setFilter] = useState<"ALL" | Rung>("ALL");
  const count: Record<Rung, number> = { RISKY: s.risky, NOT_PROVEN: s.notProven, PROVEN: s.proven };
  const collateralFindings = report.findings.filter(isCollateralFreshness);
  const visibleCollateralFindings = collateralFindings.filter((finding) => filter === "ALL" || finding.ladder === filter);

  return (
    <article className="report frame" aria-labelledby="rep-target">
      <header className="report-head">
        <div>
          <div className="target" id="rep-target">{report.target}</div>
          <div className="meta">
            <span><b>Network</b>{report.network}</span>
            <span><b>Interface</b>{report.shade}</span>
            {report.generatedAt ? <span><b>Generated</b>{report.generatedAt}</span> : null}
          </div>
        </div>
        <span className={`rung-badge ${payload.overall}`}>
          <span className={`glyph ${payload.overall}`} aria-hidden="true" />
          {LABEL[payload.overall]}
        </span>
        {report.plainSummary?.text ? (
          <div className="plain-summary">
            <p>{report.plainSummary.text}</p>
            {report.plainSummary.whatToDo ? (
              <p className="plain-summary-action">
                <span className="label">What to do</span>
                {report.plainSummary.whatToDo}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="report-summary">{payload.summary}</p>
      </header>

      <div className="ladder-bar">
        <LadderBar summary={s} animate />
        <div className="filters" role="group" aria-label="Filter findings">
          <button className="filter" type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>
            All<span className="count">{s.risky + s.notProven + s.proven}</span>
          </button>
          {ORDER.map((rung) => (
            <button key={rung} className="filter" type="button" aria-pressed={filter === rung} onClick={() => setFilter(rung)}>
              <span className={`glyph ${rung}`} aria-hidden="true" />
              {FILTER_LABEL[rung]}
              <span className="count">{count[rung]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="report-body">
        <div className="findings">
          {ORDER.map((rung) => {
            const group = report.findings.filter((finding) => finding.ladder === rung && !isCollateralFreshness(finding));
            if (group.length === 0 || (filter !== "ALL" && filter !== rung)) return null;
            return <RungGroup key={`${rung}-${filter}`} rung={rung} findings={group} />;
          })}
          {visibleCollateralFindings.length > 0 ? <LaneGroup findings={visibleCollateralFindings} /> : null}
        </div>
        <aside className="aside" aria-label="Report details">
          {report.verifier ? (
            <div>
              <h3>Verifier</h3>
              <dl className="facts">
                <div><dt>Package</dt><dd>{report.verifier.package} {report.verifier.version}</dd></div>
                <div><dt>QE identity</dt><dd>{report.verifier.qeIdentity}</dd></div>
                <div><dt>TCB status</dt><dd>{report.verifier.tcbStatus}</dd></div>
                <div>
                  <dt>PCCS allowlist</dt>
                  <dd>
                    {report.verifier.pccsAllowlist.map((url) => (
                      <span key={url} style={{ display: "block" }}>{breakable(url)}</span>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
          {report.threatModel ? (
            <div>
              <h3>Threat model</h3>
              <p>{report.threatModel}</p>
            </div>
          ) : null}
          <div>
            <h3>Approval history</h3>
            <p>On-demand approve and remove calls for this contract. Not a continuous watcher.</p>
            {report.approvalHistoryNote ? <p>{report.approvalHistoryNote}</p> : null}
            {report.approvalHistory.length === 0 ? (
              <div className="empty" style={{ marginTop: 12 }}>No approve or remove calls were loaded.</div>
            ) : (
              <ul>
                {report.approvalHistory.map((event) => (
                  <li key={event.txHash + event.method}>
                    {event.timestampIso ?? "time unknown"} {event.method} by {event.signer} (
                    {event.success ? "success" : "failed"}) — {event.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {report.limitations.length > 0 ? (
            <div>
              <h3>Limitations</h3>
              <ul>
                {report.limitations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.attribution.length > 0 ? (
            <div>
              {report.attribution.map((line) => (
                <p className="attribution" key={line}>{line}</p>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
