import type { Ladder, Report, ReportFacts } from "./types.js";

export interface GlassboxDiff {
  tool: "glassbox";
  kind: "diff";
  left: string;
  right: string;
  compose: string[];
  measurements: string[];
  codehash: string[];
  findings: string[];
  summary: string;
}

export function diffReports(left: Report, right: Report): GlassboxDiff {
  const compose = diffCompose(left.facts, right.facts);
  const measurements = diffMeasurements(left.facts, right.facts);
  const codehash = diffCodehash(left.facts, right.facts);
  const findings = diffFindings(left, right);
  const count = compose.length + measurements.length + codehash.length + findings.length;
  return {
    tool: "glassbox",
    kind: "diff",
    left: left.target,
    right: right.target,
    compose,
    measurements,
    codehash,
    findings,
    summary:
      count === 0
        ? "No compared field changed. The two reports describe the same compose, measurements, codehash, and findings that Glassbox lines up."
        : `${count} change${count === 1 ? "" : "s"} in the compared fields (compose, measurements, codehash, and findings).`,
  };
}

export function formatDiff(diff: GlassboxDiff): string {
  const lines = [
    "Glassbox diff",
    `Left:  ${diff.left}`,
    `Right: ${diff.right}`,
    "",
    diff.summary,
    "",
    "Compose",
    ...bullet(diff.compose),
    "",
    "Measurements",
    ...bullet(diff.measurements),
    "",
    "Codehash",
    ...bullet(diff.codehash),
    "",
    "Findings",
    ...bullet(diff.findings),
    "",
  ];
  return lines.join("\n");
}

function bullet(rows: string[]): string[] {
  if (rows.length === 0) return ["- No change in the fields Glassbox compared."];
  return rows.map((row) => `- ${row}`);
}

function diffCompose(left: ReportFacts, right: ReportFacts): string[] {
  const rows: string[] = [];
  pushChange(rows, "public_logs", showBool(left.publicLogs), showBool(right.publicLogs));
  pushChange(rows, "public_sysinfo", showBool(left.publicSysinfo), showBool(right.publicSysinfo));
  pushChange(rows, "dstack_version", left.dstackVersion ?? "(not declared)", right.dstackVersion ?? "(not declared)");
  pushChange(rows, "images", showList(left.images), showList(right.images));
  pushChange(rows, "secret-looking env names", showList(left.secretEnvNames), showList(right.secretEnvNames));
  return rows;
}

function diffMeasurements(left: ReportFacts, right: ReportFacts): string[] {
  const rows: string[] = [];
  for (const field of ["osImageHash", "mrtd", "rtmr0", "rtmr1", "rtmr2"] as const) {
    pushChange(rows, field === "osImageHash" ? "os_image_hash" : field, brief(left[field]), brief(right[field]));
  }
  return rows;
}

function diffCodehash(left: ReportFacts, right: ReportFacts): string[] {
  const rows: string[] = [];
  pushChange(rows, "app codehash", brief(left.appCodehash), brief(right.appCodehash));
  pushChange(rows, "contract code hash", brief(left.contractCodeHash), brief(right.contractCodeHash));
  return rows;
}

function diffFindings(left: Report, right: Report): string[] {
  const rows: string[] = [];
  const rightById = new Map(right.findings.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  for (const finding of left.findings) {
    seen.add(finding.id);
    const other = rightById.get(finding.id);
    if (!other) {
      rows.push(`${finding.id}: only on the left (${showLadder(finding.ladder)} — ${finding.title})`);
      continue;
    }
    if (finding.ladder !== other.ladder || finding.title !== other.title) {
      rows.push(
        `${finding.id}: ${showLadder(finding.ladder)} → ${showLadder(other.ladder)} (${finding.title} → ${other.title})`,
      );
    }
  }
  for (const finding of right.findings) {
    if (seen.has(finding.id)) continue;
    rows.push(`${finding.id}: only on the right (${showLadder(finding.ladder)} — ${finding.title})`);
  }
  return rows;
}

function pushChange(rows: string[], label: string, left: string, right: string): void {
  if (left === right) return;
  rows.push(`${label}: ${left} → ${right}`);
}

function showBool(value: boolean | null): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "(not set)";
}

function showList(values: string[]): string {
  if (values.length === 0) return "(none)";
  return values.join(", ");
}

function brief(value: string | null): string {
  if (!value) return "(not loaded)";
  if (value.length <= 22) return value;
  return `${value.slice(0, 12)}…${value.slice(-4)}`;
}

function showLadder(ladder: Ladder): string {
  return ladder.replace("_", " ");
}
