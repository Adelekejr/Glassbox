import type { Ladder, Report, ReportFacts } from "./types.js";

export type RegistrationIdentity = "same" | "different" | "unknown";
export type FreshnessAttribution = "same-registration" | "different-registration" | "unconfirmed";

export interface GlassboxDiff {
  tool: "glassbox";
  kind: "diff";
  left: string;
  right: string;
  leftCheckedAt: string;
  rightCheckedAt: string;
  registration: {
    identity: RegistrationIdentity;
    left: string;
    right: string;
  };
  compose: string[];
  measurements: string[];
  codehash: string[];
  findings: string[];
  collateralFreshness: {
    changed: boolean;
    attribution: FreshnessAttribution;
    left: string;
    right: string;
  };
  summary: string;
}

export function diffReports(left: Report, right: Report): GlassboxDiff {
  const compose = diffCompose(left.facts, right.facts);
  const measurements = diffMeasurements(left.facts, right.facts);
  const codehash = diffCodehash(left.facts, right.facts);
  const findings = diffFindings(left, right);
  const registration = diffRegistrationIdentity(left, right);
  const collateralFreshness = diffCollateralFreshness(left, right, registration.identity);
  const count =
    compose.length +
    measurements.length +
    codehash.length +
    findings.length +
    (registration.identity === "different" ? 1 : 0) +
    (collateralFreshness.changed ? 1 : 0);
  return {
    tool: "glassbox",
    kind: "diff",
    left: left.target,
    right: right.target,
    leftCheckedAt: left.generatedAt,
    rightCheckedAt: right.generatedAt,
    registration,
    compose,
    measurements,
    codehash,
    findings,
    collateralFreshness,
    summary:
      count === 0
        ? `No compared field changed. The reports show the same compared compose, measurements, codehash, findings, and TCB status. ${registration.identity === "same" ? "The registration transaction is confirmed unchanged." : "Registration identity could not be confirmed."}`
        : `${count} change${count === 1 ? "" : "s"} in the compared fields (agent configuration/registration, TCB collateral freshness, and findings).`,
  };
}

export function formatDiff(diff: GlassboxDiff): string {
  const identitySummary =
    diff.registration.identity === "same"
      ? "Confirmed same registration transaction."
      : diff.registration.identity === "different"
        ? "Different registration identities; do not attribute all changes to collateral alone."
        : "Registration identity is unconfirmed; a transaction hash is missing from one or both reports.";
  const attribution =
    diff.collateralFreshness.attribution === "same-registration"
      ? "The registration transaction is unchanged; this TCB status change is on the collateral-freshness baseline side."
      : diff.collateralFreshness.attribution === "different-registration"
        ? "The registrations differ; this status change cannot be attributed to collateral alone."
        : "The registration transaction could not be confirmed; this status change cannot be attributed to collateral alone.";
  const lines = [
    "Glassbox diff",
    `Left:  ${diff.left}`,
    `Right: ${diff.right}`,
    `Checks: ${diff.leftCheckedAt} → ${diff.rightCheckedAt}`,
    "",
    diff.summary,
    "",
    "Agent registration",
    `- Identity: ${identitySummary}`,
    `- Left: ${diff.registration.left}`,
    `- Right: ${diff.registration.right}`,
    "",
    "Collateral freshness (TCB baseline)",
    `- Left: ${diff.collateralFreshness.left}`,
    `- Right: ${diff.collateralFreshness.right}`,
    `- ${diff.collateralFreshness.changed ? attribution : "No change in the tdx.fresh status; these are separate report checks."}`,
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

function diffRegistrationIdentity(
  left: Report,
  right: Report,
): GlassboxDiff["registration"] {
  const leftTx = normalizeTx(left.inputs.txHash);
  const rightTx = normalizeTx(right.inputs.txHash);
  let identity: RegistrationIdentity = "unknown";
  if (left.inputs.contract !== right.inputs.contract || left.inputs.agent !== right.inputs.agent) {
    identity = "different";
  } else if (leftTx && rightTx) {
    identity = leftTx === rightTx ? "same" : "different";
  }
  return {
    identity,
    left: registrationLabel(left),
    right: registrationLabel(right),
  };
}

function diffCollateralFreshness(
  left: Report,
  right: Report,
  identity: RegistrationIdentity,
): GlassboxDiff["collateralFreshness"] {
  const leftFinding = left.findings.find((finding) => finding.id === "tdx.fresh");
  const rightFinding = right.findings.find((finding) => finding.id === "tdx.fresh");
  const leftStatus = statusLabel(leftFinding);
  const rightStatus = statusLabel(rightFinding);
  const changed = leftStatus !== rightStatus;
  return {
    changed,
    attribution:
      identity === "same"
        ? "same-registration"
        : identity === "different"
          ? "different-registration"
          : "unconfirmed",
    left: `${leftStatus}; ${freshnessTime(left)}`,
    right: `${rightStatus}; ${freshnessTime(right)}`,
  };
}

function registrationLabel(report: Report): string {
  const agent = report.inputs.agent ?? "(not recorded)";
  const tx = report.inputs.txHash ? brief(report.inputs.txHash) : "(not recorded)";
  return `contract ${report.inputs.contract}; agent ${agent}; registration transaction ${tx}`;
}

function normalizeTx(value: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}

function statusLabel(finding: Report["findings"][number] | undefined): string {
  if (!finding) return "tdx.fresh finding not present";
  return `${showLadder(finding.ladder)} — ${finding.title}`;
}

function freshnessTime(report: Report): string {
  if (report.inputs.collateralFetchedAt) {
    return `fresh collateral fetched at ${report.inputs.collateralFetchedAt}`;
  }
  return `no successful fresh-collateral fetch recorded; report generated at ${report.generatedAt}`;
}

function bullet(rows: string[]): string[] {
  if (rows.length === 0) return ["- No change in the fields Glassbox compared."];
  return rows.map((row) => `- ${row}`);
}

function diffCompose(left: ReportFacts, right: ReportFacts): string[] {
  const rows: string[] = [];
  pushChange(rows, "app_compose_sha256", brief(left.appComposeSha256), brief(right.appComposeSha256));
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
  const leftFindings = left.findings.filter((finding) => !isCollateralFreshnessFinding(finding));
  const rightFindings = right.findings.filter((finding) => !isCollateralFreshnessFinding(finding));
  const rows: string[] = [];
  const rightById = new Map(rightFindings.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  for (const finding of leftFindings) {
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
  for (const finding of rightFindings) {
    if (seen.has(finding.id)) continue;
    rows.push(`${finding.id}: only on the right (${showLadder(finding.ladder)} — ${finding.title})`);
  }
  return rows;
}

function isCollateralFreshnessFinding(finding: Report["findings"][number]): boolean {
  return finding.lane === "collateral-freshness" || finding.id === "tdx.fresh";
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
