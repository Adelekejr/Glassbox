import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditAccount, auditFile } from "./audit.js";
import type { AuditOptions } from "./audit.js";
import type { Finding, Ladder, Network, Report } from "./types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export function glassboxRepoRoot(): string {
  return repoRoot;
}

export function defaultIndexPaths(): { json: string; html: string } {
  return {
    json: join(repoRoot, "apps/web/data/proof-strip.json"),
    html: join(repoRoot, "apps/web/public/proof-strip.html"),
  };
}

export interface IndexSeed {
  accountId: string;
  network: Network;
}

/**
 * Known Shade contracts. Live crawls read register_agent, and register_worker
 * when the account is a worker proxy. Shade v2 still registers with register_agent.
 */
export const INDEX_SEEDS: readonly IndexSeed[] = [
  { accountId: "ac-sandbox.votron.testnet", network: "testnet" },
  { accountId: "ac-sandbox.ajitesh-1.testnet", network: "testnet" },
  { accountId: "ac-sandbox.nova-shade-agent.testnet", network: "testnet" },
  { accountId: "ac-sandbox.leo-leo-leo.testnet", network: "testnet" },
  { accountId: "ac-proxy.leo-leo-leo.testnet", network: "testnet" },
  { accountId: "reflect-adam-mainnet-agent-contract.near", network: "mainnet" },
  { accountId: "ironshield.near", network: "mainnet" },
];

export const INDEX_REGISTRATION_METHODS = ["register_agent", "register_worker"] as const;

/** Local files used when `glassbox index` is run without `--live`. */
export const FIXTURE_INDEX_PATHS = [
  join(repoRoot, "packages/core/test/fixtures/votron-registration.json"),
  join(repoRoot, "fixtures/compose/pinned.json"),
  join(repoRoot, "fixtures/compose/loose.json"),
] as const;

export type IndexBucket = "proven" | "vulnerable-configuration" | "not-proven";

export interface IndexRow {
  accountId: string;
  network: Report["network"];
  shade: string;
  overall: Ladder;
  bucket: IndexBucket;
  configurationClass: string;
  summary: { proven: number; notProven: number; risky: number };
  findings: { id: string; ladder: Ladder; title: string }[];
  evidence: { label: string; detail?: string }[];
  error?: string;
}

export interface AgentIndex {
  tool: "glassbox";
  kind: "agent-index";
  source: "live" | "fixture";
  generatedAt: string;
  totals: {
    scanned: number;
    proven: number;
    vulnerableConfiguration: number;
    notProven: number;
    sentence: string;
  };
  rows: IndexRow[];
  attribution: string[];
  note: string;
}

const INDEX_NOTE =
  "These rows describe registered configurations. They do not show what an account is executing now. Secret values are not included. Not proven is not a clean result. An account that is risky for another reason, such as its access keys, is counted in not proven here. The ladder on the row is the full result.";

export function configurationClass(report: Report): string {
  const range = report.findings.find((finding) => finding.id === "dstack.range");
  if (range && matchesVulnerablePhrase(range) && /not a known fixed image/i.test(`${range.title} ${range.plainEnglish}`)) {
    return "not a known fixed image";
  }
  if (report.findings.some(matchesVulnerablePhrase)) return "matches a vulnerable configuration";
  if (range?.ladder === "PROVEN" && /fixed image/i.test(range.title)) return "fixed image";
  return "not proven";
}

export function indexBucket(report: Report): IndexBucket {
  if (report.findings.some(matchesVulnerablePhrase)) return "vulnerable-configuration";
  if (report.overall === "PROVEN") return "proven";
  return "not-proven";
}

export function rowFromReport(report: Report): IndexRow {
  const risky = report.findings.filter((finding) => finding.ladder === "RISKY" || finding.id === "dstack.range");
  return {
    accountId: report.target,
    network: report.network,
    shade: report.shade,
    overall: report.overall,
    bucket: indexBucket(report),
    configurationClass: configurationClass(report),
    summary: report.summary,
    findings: report.findings.map((finding) => ({
      id: finding.id,
      ladder: finding.ladder,
      title: finding.title,
    })),
    evidence: risky.flatMap((finding) => redactEvidence(finding)),
  };
}

export function buildAgentIndex(reports: Report[], source: AgentIndex["source"], generatedAt = new Date().toISOString()): AgentIndex {
  const rows = reports.map(rowFromReport);
  return finishIndex(rows, source, generatedAt, reports.flatMap((report) => report.attribution));
}

export async function buildAgentIndexFromFiles(paths: string[], now?: Date): Promise<AgentIndex> {
  const reports: Report[] = [];
  for (const path of paths) {
    reports.push(await auditFile(path, { now }));
  }
  return buildAgentIndex(reports, "fixture", (now ?? new Date()).toISOString());
}

export async function crawlAgentIndex(
  options: AuditOptions & { seeds?: readonly IndexSeed[]; now?: Date; onProgress?: (line: string) => void } = {},
): Promise<AgentIndex> {
  const seeds = options.seeds ?? INDEX_SEEDS;
  const rows: IndexRow[] = [];
  const attribution: string[] = [];
  for (const seed of seeds) {
    options.onProgress?.(`Reading ${seed.accountId} (${seed.network}).`);
    try {
      const report = await auditAccount(seed.accountId, {
        network: seed.network,
        fetch: options.fetch,
        now: options.now,
        rpcEndpoints: options.rpcEndpoints,
        nearblocksIntervalMs: options.nearblocksIntervalMs,
        rpcIntervalMs: options.rpcIntervalMs,
        skipFreshCollateral: options.skipFreshCollateral,
        skipHistory: options.skipHistory,
        skipMpc: options.skipMpc,
        finality: options.finality,
      });
      rows.push(rowFromReport(report));
      for (const line of report.attribution) attribution.push(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        accountId: seed.accountId,
        network: seed.network,
        shade: "unknown",
        overall: "NOT_PROVEN",
        bucket: "not-proven",
        configurationClass: "not proven",
        summary: { proven: 0, notProven: 1, risky: 0 },
        findings: [],
        evidence: [],
        error: message.replace(/[\u0000-\u001f]/g, " ").slice(0, 300),
      });
    }
  }
  return finishIndex(rows, "live", (options.now ?? new Date()).toISOString(), attribution);
}

export function renderIndexHtml(index: AgentIndex): string {
  const rows = index.rows
    .map((row) => {
      const titles = row.findings
        .filter((finding) => finding.ladder === "RISKY")
        .map((finding) => escapeHtml(finding.title));
      const evidence = [
        ...titles,
        ...row.evidence.map((item) => escapeHtml(item.detail ? `${item.label} — ${item.detail}` : item.label)),
      ].join("<br>");
      const error = row.error ? `<br>${escapeHtml(row.error)}` : "";
      return `<tr>
        <td>${escapeHtml(row.accountId)}</td>
        <td>${escapeHtml(row.network)}</td>
        <td>${escapeHtml(row.overall.replace("_", " "))}</td>
        <td>${escapeHtml(row.configurationClass)}</td>
        <td>${evidence}${error}</td>
      </tr>`;
    })
    .join("\n");
  const attribution = index.attribution.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Glassbox proof strip</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; color: #1c1c1c; line-height: 1.45; }
    h1 { font-size: 1.3rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-top: 1px solid #ddd; text-align: left; vertical-align: top; padding: 0.45rem 0.5rem; }
    th { font-size: 0.8rem; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <h1>Glassbox</h1>
  <p><strong>${escapeHtml(index.totals.sentence)}</strong></p>
  <p>${escapeHtml(index.note)}</p>
  <table>
    <thead>
      <tr><th>Account</th><th>Network</th><th>Ladder</th><th>Configuration</th><th>Redacted evidence</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  ${attribution}
  <p>Registrations are read with register_agent and register_worker. Source: ${escapeHtml(index.source)}. Generated ${escapeHtml(index.generatedAt)}.</p>
</body>
</html>
`;
}

function finishIndex(rows: IndexRow[], source: AgentIndex["source"], generatedAt: string, attribution: string[]): AgentIndex {
  const proven = rows.filter((row) => row.bucket === "proven").length;
  const vulnerableConfiguration = rows.filter((row) => row.bucket === "vulnerable-configuration").length;
  const notProven = rows.filter((row) => row.bucket === "not-proven").length;
  const scanned = rows.length;
  return {
    tool: "glassbox",
    kind: "agent-index",
    source,
    generatedAt,
    totals: {
      scanned,
      proven,
      vulnerableConfiguration,
      notProven,
      sentence: `${scanned} agents scanned · ${proven} proven · ${vulnerableConfiguration} match a vulnerable configuration · ${notProven} not proven`,
    },
    rows,
    attribution: [...new Set(attribution)],
    note: INDEX_NOTE,
  };
}

function matchesVulnerablePhrase(finding: Finding): boolean {
  if (finding.ladder !== "RISKY") return false;
  const text = `${finding.title} ${finding.plainEnglish}`;
  return /matches a vulnerable configuration/i.test(text) || /not a known fixed image/i.test(text);
}

function redactEvidence(finding: Finding): { label: string; detail?: string }[] {
  const items = finding.evidence.length > 0 ? finding.evidence : [{ label: finding.title }];
  return items.slice(0, 8).map((item) => {
    const detail = item.detail && item.detail.length <= 160 ? item.detail : undefined;
    return detail ? { label: item.label, detail } : { label: item.label };
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
