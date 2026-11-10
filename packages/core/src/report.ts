import { isDebugImage, isSecretEnvName } from "./evidence/compose.js";
import { DCAP_QVL_VERSION, PINNED_PCCS_URL, verifierMetadata } from "./checks/pccs.js";
import { assessApprover, assessContractCode, assessRemove } from "./checks/contract.js";
import { unattemptedLiveObservation } from "./checks/liveness.js";
import { assessProvenance } from "./checks/provenance.js";
import { digestsEqual, isDigest, isNotInATee, nonDigestSentence, normalizeDigest } from "./evidence/digest.js";
import { compareMeasurements, firstNonDigestField, isZeroMeasurement, type MeasurementComparison } from "./evidence/measurements.js";
import { eventPayload, hasEvent, selectOsImageHash } from "./evidence/registration.js";
import { assessAccessKeys } from "./checks/access-keys.js";
import { assessDstack } from "./checks/dstack.js";
import { entryExpiry, formatExpiry, matchingDigests } from "./checks/mpc.js";
import { measurementsEqual, replayAll } from "./checks/rtmr.js";
import { verifyQuoteAt } from "./checks/tdx.js";
import { upgradePlainEnglish } from "./checks/upgrade.js";
import { matchShadeMeasurements } from "./data/shade-measurements.js";
import { formatHistoryCacheAge } from "./near/history.js";
import { attachProvenance } from "./provenance.js";
import { canonicalSha256 } from "./signed/canonical.js";
import { planReportAnchor } from "./signed/anchor.js";
import { buildCanonicalBody } from "./signed/report.js";
import {
  GLASSBOX_VERSION,
  MEASURE_REPO_URL,
  PHALA_POSTMORTEM_URL,
  TEE_FAIL_URL,
  THREAT_MODEL_DISCLOSURE,
  accountUrl,
  advisoryUrl,
  isoFromUnixMs,
  txUrl,
  type ApprovedMeasurementRow,
  type EvidenceBundle,
  type EvidenceLink,
  type Finding,
  type Freshness,
  type Ladder,
  type Measurements,
  type Report,
  type ReportFacts,
  type ReportInputs,
} from "./types.js";

const LADDER_ORDER: Ladder[] = ["RISKY", "NOT_PROVEN", "PROVEN"];

export interface AgentCheck {
  overall: Ladder;
  summary: string;
  report: Report;
}

export function presentCheck(report: Report): AgentCheck {
  return { overall: report.overall, summary: report.overallPlainEnglish, report };
}

export function summarizeFindings(findings: Finding[]): {
  summary: Report["summary"];
  overall: Ladder;
} {
  const summary = {
    proven: findings.filter((finding) => finding.ladder === "PROVEN").length,
    notProven: findings.filter((finding) => finding.ladder === "NOT_PROVEN").length,
    risky: findings.filter((finding) => finding.ladder === "RISKY").length,
  };
  const overall: Ladder = summary.risky > 0 ? "RISKY" : summary.notProven > 0 ? "NOT_PROVEN" : "PROVEN";
  return { summary, overall };
}

export function buildReport(bundle: EvidenceBundle, options?: { now?: Date; anchorIntent?: boolean }): Report {
  const now = options?.now ?? new Date(bundle.generatedAt);
  const findings = [
    runtimeFinding(),
    freshnessFinding(bundle, now),
    shadeFinding(bundle),
    ...attestationFindings(bundle, now),
    ...approvalFindings(bundle, now),
    ...composeFindings(bundle, now),
    provenanceFinding(bundle),
    ...contractFindings(bundle),
    accessFinding(bundle),
    mpcFinding(bundle, now),
  ].filter((finding): finding is Finding => finding !== null)
    .map((finding) => attachProvenance(finding, bundle));

  findings.sort((a, b) => LADDER_ORDER.indexOf(a.ladder) - LADDER_ORDER.indexOf(b.ladder) || a.id.localeCompare(b.id));

  const { summary, overall } = summarizeFindings(findings);

  const report: Report = {
    tool: "glassbox",
    version: GLASSBOX_VERSION,
    verifier: verifierMetadata(),
    target: bundle.target,
    network: bundle.network,
    shade: bundle.shade,
    generatedAt: bundle.generatedAt,
    inputs: reportInputs(bundle),
    threatModel: THREAT_MODEL_DISCLOSURE,
    freshness: reportFreshness(bundle, now),
    facts: reportFacts(bundle),
    anchor: {
      status: "skipped",
      intent: false,
      reason: "Report hash anchoring is off. Glassbox does not send a transaction.",
    },
    summary,
    overall,
    overallPlainEnglish: `Highest rung on this ladder is ${overall.replace("_", " ")} (${summary.risky} risky, ${summary.notProven} not proven, ${summary.proven} proven). That is the strongest concern already listed. It is not a separate check.`,
    findings,
    methodProbes: bundle.methodProbes,
    approvalHistory: bundle.approvalHistory ?? [],
    approvalHistoryNote: bundle.approvalHistoryNote,
    limitations: [
      "Findings that cite a quote or an app compose describe the registered configuration. They do not establish what the account is executing now.",
      "A valid TDX quote proves a TDX-attested registered configuration. It does not prove an honest operator. See the threat-model paragraph.",
      "Glassbox does not judge payment correctness, and it has no payment or send step. That is Gideon (https://github.com/Adelekejr/Gideon-near), a separate NEAR pre-send checker by the same builder.",
      "Comparisons with Shade's 0.5.7/0.5.8 table use that project's published measurements. Heuristics are marked on the finding.",
      ...(bundle.historySource === "file"
        ? [
            "This report was built from a file or pasted JSON. A PROVEN row compares values in that input, or verifies a quote carried in it. It is not a fresh chain read.",
          ]
        : []),
    ],
    sources: sourceLines(bundle),
    attribution: attributionLines(bundle),
  };
  report.anchor = planReportAnchor({
    reportSha256: canonicalSha256(buildCanonicalBody(report)),
    network: report.network,
    contract: report.inputs.contract,
    intent: options?.anchorIntent,
  });
  return report;
}

export function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push("Glassbox report");
  lines.push(`Target:     ${report.target}`);
  lines.push(`Network:    ${report.network}`);
  lines.push(`Interface:  ${report.shade}`);
  lines.push(`Generated:  ${report.generatedAt}`);
  lines.push(
    `Verifier:   ${report.verifier.package} ${report.verifier.version} (QE identity ${report.verifier.qeIdentity}; TCB status ${report.verifier.tcbStatus})`,
  );
  lines.push(`PCCS:       ${report.verifier.pccsAllowlist.join(", ")} (caller URLs are not accepted)`);
  lines.push("");
  lines.push(
    `Summary: ${report.summary.risky} risky, ${report.summary.notProven} not proven, ${report.summary.proven} proven.`,
  );
  lines.push(report.overallPlainEnglish);
  lines.push(
    "This report describes the registered configuration. It does not establish what the account is executing now.",
  );
  lines.push("");
  lines.push("Threat model");
  lines.push(report.threatModel);
  lines.push("");
  lines.push("Freshness");
  lines.push(
    `Registration: ${report.freshness.registrationTime ?? "not loaded"}`,
  );
  lines.push(`Age:          ${report.freshness.attestationAge ?? "not computed"}`);
  if (report.freshness.validUntil.length === 0) {
    lines.push("valid_until:  none on this report");
  } else {
    for (const item of report.freshness.validUntil) {
      lines.push(`valid_until:  ${item.accountId} ${item.validUntil}`);
    }
  }
  lines.push("Proven at registration only.");
  lines.push(report.freshness.live.detail);
  lines.push("");
  for (const ladder of LADDER_ORDER) {
    const group = report.findings.filter((finding) => finding.ladder === ladder && finding.lane !== "collateral-freshness");
    if (group.length === 0) continue;
    lines.push(ladder.replace("_", " "));
    group.forEach((finding, index) => appendFinding(lines, finding, index));
  }
  const collateralFindings = report.findings.filter((finding) => finding.lane === "collateral-freshness");
  if (collateralFindings.length > 0) {
    lines.push("Collateral freshness (external TCB baseline)");
    lines.push("This lane checks the registered quote against fresh PCCS collateral; a change here does not mean the agent registration/configuration changed.");
    collateralFindings.forEach((finding, index) => appendFinding(lines, finding, index));
  }
  lines.push("Approval history");
  lines.push("On-demand approve and remove calls for this one contract. Not a continuous watcher.");
  if (report.approvalHistoryNote) lines.push(report.approvalHistoryNote);
  if (report.approvalHistory.length === 0) {
    lines.push("- No approve or remove calls were loaded.");
  }
  for (const event of report.approvalHistory) {
    const when = event.timestampIso ?? "time unknown";
    const status = event.success ? "success" : "failed";
    lines.push(`- ${when} ${event.method} by ${event.signer} (${status}) — ${event.detail} — ${event.txHash}`);
  }
  lines.push("");
  if (report.limitations.length > 0) {
    lines.push("Limits");
    for (const line of report.limitations) lines.push(`- ${line}`);
    lines.push("");
  }
  if (report.sources.length > 0) {
    lines.push("Sources");
    for (const line of report.sources) lines.push(`- ${line}`);
    lines.push("");
  }
  if (report.attribution.length > 0) {
    for (const line of report.attribution) lines.push(line);
    lines.push("");
  }
  lines.push("Report hash anchor");
  lines.push(report.anchor.reason);
  lines.push("");
  return lines.join("\n").trimEnd() + "\n";
}

function appendFinding(lines: string[], finding: Finding, index: number): void {
  lines.push(`${index + 1}. ${finding.title}`);
  lines.push(
    `   Provenance: ${finding.provenance.evidenceSource} / ${finding.provenance.observationKind}. ${finding.provenance.label}`,
  );
  lines.push(`   ${finding.plainEnglish}`);
  if (finding.inference) lines.push("   Marked as an inference.");
  if (finding.evidence.length > 0) {
    lines.push("   Evidence:");
    for (const item of finding.evidence) {
      const url = item.url ? ` (${item.url})` : "";
      const detail = item.detail ? ` — ${item.detail}` : "";
      lines.push(`   - ${item.label}${detail}${url}`);
    }
  }
  lines.push("");
}

function attestationFindings(bundle: EvidenceBundle, now: Date): Finding[] {
  if (bundle.shade === "mpc-signer") {
    return [
      make("tdx.registration", "NOT_PROVEN", "No TDX quote is expected from this account", false, 
        "This account exposes allowed_docker_image_hashes. That view is an MPC docker allowlist, not a Shade agent registration, so there is no quote to verify."),
    ];
  }
  const registration = bundle.registration;
  if (!registration?.quoteHex) {
    if (bundle.shade === "measurements-registry") return [];
    return [
      make(
        "tdx.registration",
        "NOT_PROVEN",
        "No registration quote was loaded",
        false,
        missingQuoteText(bundle),
        countEvidence(bundle),
      ),
    ];
  }

  const registeredAt =
    typeof registration.timestampSec === "number" ? isoFromUnixMs(registration.timestampSec * 1000) : undefined;
  const when = registeredAt ? `at registration (${registeredAt})` : "at the stored collateral's check time";
  const stored = registration.collateral
    ? verifyQuoteAt(
        registration.quoteHex,
        registration.collateral,
        registeredAt && registration.timestampSec !== undefined
          ? registration.timestampSec
          : fallbackCollateralTime(registration.collateral),
      )
    : null;

  const findings: Finding[] = [];
  const fresh = bundle.freshCollateral
    ? verifyQuoteAt(registration.quoteHex, bundle.freshCollateral, Math.floor(now.getTime() / 1000))
    : null;
  findings.push(signatureFinding(bundle, stored));
  findings.push(qeIdentityFinding(bundle, stored));
  findings.push(noteRegistrationCache(bundle, registrationTcbFinding(bundle, stored, when)));
  findings.push(freshTcbFinding(bundle, fresh));
  findings.push(advisoryFinding(bundle, stored, fresh));

  // Parsed quote fields are not evidence until QuoteVerifier accepts the signature.
  // A crafted quote can parse and still fail verification.
  const unverified = Boolean(stored && !stored.ok);
  if (unverified) {
    findings.push(
      make(
        "tdx.debug",
        "NOT_PROVEN",
        "Debug bit was not accepted",
        false,
        "The quote did not verify, so the debug bit was not accepted.",
        txEvidence(bundle),
      ),
    );
    findings.push(
      make(
        "tdx.report_data",
        "NOT_PROVEN",
        "Quote report data was not accepted",
        false,
        "The quote did not verify, so its report data was not treated as bound to an account.",
        txEvidence(bundle),
      ),
    );
    findings.push(
      make(
        "measurements.quote_match",
        "NOT_PROVEN",
        "Quote measurements were not accepted",
        false,
        "The quote did not verify, so its measurements were not compared as attested values.",
        txEvidence(bundle),
      ),
    );
  } else {
    const debug = stored?.debug ?? null;
    if (debug === true) {
      findings.push(
        make(
          "tdx.debug",
          "RISKY",
          "TDX debug mode is set on the registered quote",
          false,
          "The quote's TDX debug bit is set. A debug TD is not a production attestation.",
          txEvidence(bundle),
        ),
      );
    } else if (debug === false) {
      findings.push(
        make(
          "tdx.debug",
          "PROVEN",
          "Registered quote is not a debug TD",
          false,
          "The quote's TDX debug bit is clear.",
          txEvidence(bundle),
        ),
      );
    } else {
      findings.push(
        make("tdx.debug", "NOT_PROVEN", "Debug bit was not read", false, "The quote did not yield a TDX attributes field, so debug mode was not read."),
      );
    }
    findings.push(reportDataFinding(bundle, stored?.reportData ?? null));
    findings.push(quoteMatchFinding(bundle, stored?.measurements ?? null));
  }
  findings.push(replayFinding(bundle));
  findings.push(composeHashFinding(bundle));
  return findings;
}

function reportDataFinding(bundle: EvidenceBundle, reportData: string | null): Finding {
  const agent = bundle.registration?.agentId;
  if (!reportData) {
    return make("tdx.report_data", "NOT_PROVEN", "Quote report data was not read", false, "The quote did not yield report data, so it was not bound to an account.");
  }
  if (agent && reportData === agent) {
    const bound = fromFile(bundle)
      ? `the account id recorded in this file. This run did not read that registration from chain.`
      : `the same account that submitted the registration.`;
    return make(
      "tdx.report_data",
      "PROVEN",
      "Quote report data binds the registering account",
      false,
      `The quote's report data is the ASCII account id ${agent}, ${bound}`,
      txEvidence(bundle),
    );
  }
  if (agent) {
    return make(
      "tdx.report_data",
      "RISKY",
      "Quote report data does not bind the registering account",
      false,
      `The quote's report data decodes to "${truncate(reportData)}", which is not the registering account ${agent}.`,
      txEvidence(bundle),
    );
  }
  return make(
    "tdx.report_data",
    "NOT_PROVEN",
    "Quote report data has no account to bind to",
    false,
    `The quote's report data decodes to "${truncate(reportData)}". No registering account was supplied to compare it with.`,
  );
}

function quoteMatchFinding(bundle: EvidenceBundle, fromQuote: Measurements | null): Finding {
  const tcb = bundle.registration?.tcbInfo;
  if (!fromQuote || !tcb) {
    return make(
      "measurements.quote_match",
      "NOT_PROVEN",
      "Quote measurements were not compared",
      false,
      "Both a parsed quote and registered tcb_info measurements are required for this comparison.",
    );
  }
  const registered: Measurements = {
    mrtd: tcb.mrtd,
    rtmr0: tcb.rtmr0,
    rtmr1: tcb.rtmr1,
    rtmr2: tcb.rtmr2,
    rtmr3: tcb.rtmr3,
  };
  const fields = ["mrtd", "rtmr0", "rtmr1", "rtmr2", "rtmr3"] as const;
  const badMeasurement = presentNonDigest(fields.flatMap((field) => [fromQuote[field], registered[field]]));
  if (badMeasurement) {
    return make(
      "measurements.quote_match",
      "NOT_PROVEN",
      "Quote measurements are not real hashes",
      false,
      nonDigestSentence(badMeasurement, "measurement", "the registered configuration"),
      txEvidence(bundle),
    );
  }
  if (measurementsEqual(fromQuote, registered, [...fields])) {
    return make(
      "measurements.quote_match",
      "PROVEN",
      "Quote measurements match the registered tcb_info",
      false,
      "MRTD and RTMR0 through RTMR3 inside the verified quote equal the values stored with the registration.",
      txEvidence(bundle),
    );
  }
  return make(
    "measurements.quote_match",
    "RISKY",
    "Quote measurements differ from the registered tcb_info",
    false,
    "At least one of MRTD or RTMR0 through RTMR3 inside the quote differs from the registered tcb_info.",
    txEvidence(bundle),
  );
}

function replayFinding(bundle: EvidenceBundle): Finding {
  const events = bundle.registration?.tcbInfo?.event_log;
  const tcb = bundle.registration?.tcbInfo;
  if (!events || events.length === 0 || !tcb?.rtmr3) {
    return make(
      "rtmr.replay",
      "NOT_PROVEN",
      "RTMR replay had no event log",
      false,
      "The registration did not include an event log, so RTMR3 was not replayed.",
    );
  }
  try {
    const replayed = replayAll(events);
    const fields = ["rtmr0", "rtmr1", "rtmr2", "rtmr3"] as const;
    const badMeasurement = presentNonDigest(fields.map((field) => tcb[field]));
    if (badMeasurement) {
      return make(
        "rtmr.replay",
        "NOT_PROVEN",
        "RTMR replay was not a real hash comparison",
        false,
        nonDigestSentence(badMeasurement, "measurement", "the registered configuration"),
        txEvidence(bundle),
      );
    }
    if (measurementsEqual(replayed, tcb, [...fields])) {
      return make(
        "rtmr.replay",
        "PROVEN",
        "RTMR replay matches the registered values",
        false,
        "Replaying the event log with SHA-384(current || event digest), starting from 48 zero bytes, reproduces registered RTMR0 through RTMR3. RTMR3 covers the app events, including compose-hash.",
        txEvidence(bundle),
      );
    }
    return make(
      "rtmr.replay",
      "RISKY",
      "RTMR replay does not match the registered values",
      false,
      "Replaying the event log did not reproduce the registered RTMR0 through RTMR3.",
      txEvidence(bundle),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return make("rtmr.replay", "NOT_PROVEN", "RTMR replay could not finish", false, message);
  }
}

function composeHashFinding(bundle: EvidenceBundle): Finding {
  const tcb = bundle.registration?.tcbInfo;
  const payload = eventPayload(tcb?.event_log, "compose-hash") ?? tcb?.compose_hash;
  if (!payload) {
    return make(
      "compose.hash",
      "NOT_PROVEN",
      "No compose-hash event was registered",
      false,
      "The event log has no compose-hash event, so the app compose was not tied to RTMR3 that way.",
    );
  }
  if (!isDigest(payload)) {
    return make(
      "compose.hash",
      "NOT_PROVEN",
      "Compose hash is not a real hash",
      false,
      nonDigestSentence(payload, "compose hash", "the registered compose"),
      txEvidence(bundle),
    );
  }
  const recorded = bundle.registration?.appComposeSha256;
  if (recorded && !isDigest(recorded)) {
    return make(
      "compose.hash",
      "NOT_PROVEN",
      "Compose hash is not a real hash",
      false,
      nonDigestSentence(recorded, "compose hash", "the registered compose"),
      txEvidence(bundle),
    );
  }
  const redacted = bundle.registration?.appComposeRedacted === true;
  if (recorded && digestsEqual(recorded, payload)) {
    const fileNote = fromFile(bundle) ? " This run did not re-read the registration from chain." : "";
    const sentence = redacted
      ? `The compose-hash event payload equals the sha256 recorded for the on-chain app_compose string (${payload}). Secret-looking values were removed from the local copy, so this match is against the chain string, not against that redacted copy.${fileNote}`
      : `sha256 of the registered app_compose string equals the compose-hash event payload (${payload}).${fileNote}`;
    return make("compose.hash", "PROVEN", "Compose hash matches the registered event", false, sentence, txEvidence(bundle));
  }
  if (recorded) {
    return make(
      "compose.hash",
      "RISKY",
      "Compose hash does not match the registered event",
      false,
      `sha256 of the app_compose string is ${recorded}, and the compose-hash event payload is ${payload}.`,
      txEvidence(bundle),
    );
  }
  return make(
    "compose.hash",
    "NOT_PROVEN",
    "Compose hash was not computed",
    false,
    "A compose-hash event is present, and the app_compose string was not available to hash.",
  );
}

function approvalFindings(bundle: EvidenceBundle, now: Date): Finding[] {
  const findings: Finding[] = [];
  const localDefault = localDefaultFinding(bundle);
  if (localDefault) findings.push(localDefault);
  const validity = validityFinding(bundle, now);
  if (validity) findings.push(validity);
  const measurementsProbe = bundle.methodProbes?.find((probe) => probe.name === "get_approved_measurements");
  if (bundle.shade === "shade-v1" || bundle.shade === "shade-v1-worker") {
    findings.push(codehashFinding(bundle));
    if (measurementsProbe?.outcome !== "unavailable") {
      findings.push(
        make(
          "measurements.approved",
          "NOT_PROVEN",
          "No on-contract list of approved TDX measurements",
          false,
          "This Shade v1 interface does not expose a view of approved TDX measurements. The codehash check, when it succeeds, covers the app image digest only.",
        ),
      );
    }
  }
  if (measurementsProbe?.outcome === "unavailable") {
    findings.push(
      make(
        "measurements.approved",
        "NOT_PROVEN",
        "Approved measurements were not read",
        false,
        "get_approved_measurements did not answer. The RPC call failed. That is not MethodNotFound, and it is not an empty approved list.",
      ),
    );
  } else if (bundle.approvedMeasurements && bundle.approvedMeasurements.length > 0) {
    findings.push(measurementListFinding(bundle));
  } else if (bundle.shade === "shade-v2") {
    findings.push(
      make(
        "measurements.approved",
        "NOT_PROVEN",
        "Approved measurements were not loaded",
        false,
        "Shade v2 can expose get_approved_measurements, and that view was not loaded for this account.",
      ),
    );
  }
  return findings;
}

function registeredMeasurementRows(bundle: EvidenceBundle): ApprovedMeasurementRow[] {
  if (bundle.v2Agents && bundle.v2Agents.length > 0) return bundle.v2Agents.map((agent) => agent.measurements);
  const tcb = bundle.registration?.tcbInfo;
  if (tcb?.mrtd && tcb.rtmr0 && tcb.rtmr1 && tcb.rtmr2) {
    return [
      {
        mrtd: tcb.mrtd,
        rtmr0: tcb.rtmr0,
        rtmr1: tcb.rtmr1,
        rtmr2: tcb.rtmr2,
        rtmr3: tcb.rtmr3,
        app_compose_hash_payload: bundle.registration?.appComposeSha256,
      },
    ];
  }
  return [];
}

function localDefaultFinding(bundle: EvidenceBundle): Finding | null {
  const zeros = (bundle.v2Agents ?? []).filter((agent) => isZeroMeasurement(agent.measurements));
  if (zeros.length === 0) return null;
  return make(
    "measurements.local_default",
    "RISKY",
    "Registered measurements are the all-zero local-mode default",
    false,
    `${zeros.length} registered agent${zeros.length === 1 ? "" : "s"} store all-zero MRTD and RTMR0 through RTMR2. That is the Shade local-mode default. It is not a TDX measurement.`,
    zeros.map((agent) => ({ label: agent.accountId })),
  );
}

function validityFinding(bundle: EvidenceBundle, now: Date): Finding | null {
  const agents = bundle.v2Agents;
  if (!agents || agents.length === 0) return null;
  const expired = agents.filter((agent) => agent.validUntilMs !== undefined && agent.validUntilMs < now.getTime());
  const invalid = agents.filter((agent) => agent.valid === false);
  const unknown = agents.filter((agent) => agent.valid == null);
  if (invalid.length > 0 || expired.length > 0) {
    return make(
      "agent.validity",
      "RISKY",
      "A registered agent is not valid on the contract",
      false,
      [
        ...invalid.map((agent) => `${agent.accountId} is ${agent.validity}.`),
        ...expired.map(
          (agent) =>
            `${agent.accountId} validity ended at ${isoFromUnixMs(agent.validUntilMs ?? 0) ?? "an unreadable time"}.`,
        ),
      ].join(" "),
    );
  }
  if (unknown.length > 0) {
    const named = unknown
      .map((agent) => `The view for ${agent.accountId} did not include a recognized validity field.`)
      .join(" ");
    return make(
      "agent.validity",
      "NOT_PROVEN",
      "Agent validity was not in the view",
      false,
      `${named} Whether that agent is valid was not proven.`,
    );
  }
  return make(
    "agent.validity",
    "PROVEN",
    "The contract reports the registered agent as valid",
    false,
    agents
      .map((agent) => {
        const until = agent.validUntilMs !== undefined ? (isoFromUnixMs(agent.validUntilMs) ?? "an unreadable time") : "an unknown time";
        return `${agent.accountId} is ${agent.validity} until ${until}.`;
      })
      .join(" "),
  );
}

function bestMeasurementComparison(
  rows: ApprovedMeasurementRow[],
  candidate: ApprovedMeasurementRow,
  requireClaimedFields: boolean,
): MeasurementComparison {
  const results = rows.map((row) => compareMeasurements(row, candidate, requireClaimedFields));
  if (results.includes("match")) return "match";
  if (results.every((result) => result === "mismatch")) return "mismatch";
  const others = results.filter((result) => result !== "not-digest");
  if (results.includes("not-digest") && others.length > 0 && others.every((result) => result === "mismatch")) {
    return "mismatch";
  }
  if (results.includes("not-digest")) return "not-digest";
  return "incomplete";
}

function codehashFinding(bundle: EvidenceBundle): Finding {
  const rawCodehash = bundle.agentView?.codehash;
  const codehash = normalizeDigest(rawCodehash) ?? rawCodehash?.trim().toLowerCase();
  const approved = bundle.approvedCodehashes ?? [];
  const network = bundle.network === "offline" ? "testnet" : bundle.network;
  const file = fromFile(bundle);
  const agentProbe = bundle.methodProbes?.find((probe) => probe.name === "get_agent");
  const regMethod = bundle.shade === "shade-v1-worker" ? "register_worker" : "register_agent";
  const historyMiss = [regMethod, "approve_codehash"].filter((method) => bundle.historyFailedMethods?.includes(method));
  if (!file && historyMiss.length > 0 && !codehash) {
    return make(
      "codehash.approved",
      "NOT_PROVEN",
      "Agent codehash was not loaded",
      false,
      `Could not read history for ${historyMiss.join(", ")}, so the registering account was not known and get_agent was not called. A failed history read is not an empty index.`,
    );
  }
  if (!file && bundle.historyFailedMethods?.includes("approve_codehash")) {
    return make(
      "codehash.approved",
      "NOT_PROVEN",
      "App codehash was not compared with approve_codehash history",
      false,
      withCodehashCache(
        bundle,
        `Could not read history for approve_codehash${codehash ? `. get_agent returns codehash ${codehash}` : ""}, so this codehash was not compared with an approval. A failed history read is not proof the codehash was never approved.`,
      ),
    );
  }
  if (!codehash && (agentProbe?.outcome === "unavailable" || bundle.agentViewError)) {
    const detail = bundle.agentViewError ?? agentProbe?.detail ?? "the RPC call failed";
    return make(
      "codehash.approved",
      "NOT_PROVEN",
      "Agent codehash was not loaded",
      false,
      `get_agent did not answer (${detail}). A transport failure is not MethodNotFound, so the codehash was not compared with approve_codehash history.`,
    );
  }
  if (!codehash) {
    const empty = typeof rawCodehash === "string";
    return make(
      "codehash.approved",
      "NOT_PROVEN",
      empty ? "App codehash is not a real hash" : "Agent codehash was not loaded",
      false,
      empty
        ? withCodehashCache(
            bundle,
            `${nonDigestSentence("", "code hash")}${file ? " This run did not call get_agent." : ""}`,
          )
        : file
          ? "The file did not include a codehash, so it was not compared with approve_codehash history. This run did not call get_agent."
          : "get_agent did not return a codehash, so it was not compared with approve_codehash history.",
    );
  }
  if (!isDigest(codehash)) {
    const what = isNotInATee(codehash) ? "approved code hash" : "code hash";
    return make(
      "codehash.approved",
      "NOT_PROVEN",
      "App codehash is not a real hash",
      false,
      withCodehashCache(bundle, `${nonDigestSentence(codehash, what)}${file ? " This run did not call get_agent." : ""}`),
      [{ label: file ? "codehash in the file" : "get_agent codehash", detail: codehash }],
    );
  }
  const hit = approved.find((row) => digestsEqual(row.codehash, codehash));
  if (hit) {
    const evidence: EvidenceLink[] = [
      { label: file ? "codehash in the file" : "get_agent codehash", detail: codehash },
    ];
    if (hit.txHash && bundle.network !== "offline" && !file) {
      evidence.push({ label: "approve_codehash transaction", url: txUrl(network, hit.txHash), detail: hit.txHash });
    } else if (hit.txHash) {
      evidence.push({ label: file ? "approve_codehash row in the file" : "approve_codehash transaction", detail: hit.txHash });
    }
    const sentence = withCodehashCache(
      bundle,
      file
        ? `The file records codehash ${codehash}, and an approve_codehash row in that file has the same value. This run did not call get_agent or re-read that transaction. On Shade v1 this is the app image digest, not a TDX measurement.`
        : `get_agent returns codehash ${codehash}, and an approve_codehash transaction records that same value. On Shade v1 this is the app image digest, not a TDX measurement.`,
    );
    return make(
      "codehash.approved",
      "PROVEN",
      "App codehash is in approve_codehash history",
      false,
      sentence,
      evidence,
    );
  }
  const missed = file
    ? `The file records codehash ${codehash}. It was not in the approve_codehash rows in this file. This run did not call get_agent. An index can be incomplete, so this is not proof the codehash was never approved.`
    : bundle.codehashArgsUnreadable
      ? `get_agent returns codehash ${codehash}. Arguments for one or more approve_codehash transactions could not be read, so this is not proof the codehash was never approved.`
      : `get_agent returns codehash ${codehash}. It was not in the approve_codehash history returned for this account. That index can be incomplete, so this is not proof the codehash was never approved.`;
  return make(
    "codehash.approved",
    "NOT_PROVEN",
    "App codehash was not seen in approve_codehash history",
    false,
    withCodehashCache(bundle, missed),
    [{ label: "approve_codehash rows scanned", detail: String(approved.length) }],
  );
}

function measurementListFinding(bundle: EvidenceBundle): Finding {
  const rows = bundle.approvedMeasurements ?? [];
  const registered = registeredMeasurementRows(bundle);
  if (registered.length > 0) {
    const requireClaimed = Boolean(bundle.v2Agents?.length);
    const compared = registered.map((candidate) => bestMeasurementComparison(rows, candidate, requireClaimed));
    if (compared.every((result) => result === "match")) {
      return make(
        "measurements.approved",
        "PROVEN",
        "Registered measurements are on the approved list",
        false,
        requireClaimed
          ? `Each registered agent's MRTD, RTMR0 through RTMR2, key-provider digest, and app-compose hash match a row from get_approved_measurements (${registered.length} agent${registered.length === 1 ? "" : "s"}).`
          : "The registered MRTD and RTMR0 through RTMR2 match a row from the contract's approved-measurements view.",
        bundle.v2Agents?.map((agent) => ({ label: agent.accountId, detail: agent.validity })) ?? [],
      );
    }
    const mismatches = compared.filter((result) => result === "mismatch").length;
    if (mismatches > 0) {
      return make(
        "measurements.approved",
        "RISKY",
        "Registered measurements are not on the approved list",
        false,
        `The contract published ${rows.length} approved measurement row${rows.length === 1 ? "" : "s"}, and ${mismatches} registered measurement set${mismatches === 1 ? " is" : "s are"} not on it.`,
        [{ label: "Approved rows", detail: String(rows.length) }],
      );
    }
    if (compared.includes("not-digest")) {
      const bad = firstNonDigestField([...registered, ...rows]);
      return make(
        "measurements.approved",
        "NOT_PROVEN",
        "Approved measurements are not real hashes",
        false,
        bad
          ? nonDigestSentence(bad.value, bad.what, "the measurement")
          : "A value in this comparison is not a real hash, so it proves nothing about the measurement.",
        [{ label: "Approved rows", detail: String(rows.length) }],
      );
    }
    return make(
      "measurements.approved",
      "NOT_PROVEN",
      "Approved measurement comparison is incomplete",
      false,
      requireClaimed
        ? "A match needs MRTD, RTMR0 through RTMR2, the key-provider digest, and the app-compose hash on both the registered agent and the approved row. At least one of those fields was missing, so the comparison is incomplete. A missing field is not a match."
        : "A match needs MRTD and RTMR0 through RTMR2 on both the registered measurements and the approved row. At least one of those fields was missing, so the comparison is incomplete. A missing field is not a match.",
      [{ label: "Approved rows", detail: String(rows.length) }],
    );
  }
  const tableHits = rows.filter((row) => matchShadeMeasurements(row)?.mrtdMatched === true);
  if (tableHits.length > 0) {
    return make(
      "measurements.approved",
      "RISKY",
      "An approved row matches a vulnerable configuration",
      false,
      `${tableHits.length} of ${rows.length} approved measurement rows match Shade's published table for dstack 0.5.7 or 0.5.8, which is inside 0.3.1–0.6.0. The match is against that table.`,
      [{ label: "Shade measurement tables", detail: "Apache-2.0, dstack 0.5.7 and 0.5.8 only" }],
    );
  }
  return make(
    "measurements.approved",
    "NOT_PROVEN",
    "Approved measurements do not name a known dstack release",
    false,
    `${rows.length} approved measurement rows were read. None of the rows are a clean match for Shade's 0.5.7 or 0.5.8 tables. A clean match needs RTMR1 and RTMR2, and the MRTD when it is present. This view did not include an os_image_hash. The dstack release of those rows is not proven. Unknown is not a claim that the rows are fixed.`,
    [{ label: "Approved rows", detail: String(rows.length) }],
  );
}

function composeFindings(bundle: EvidenceBundle, now: Date): Finding[] {
  if (bundle.shade === "mpc-signer") return [];
  const compose = bundle.compose;
  const tcb = bundle.registration?.tcbInfo;
  const selected = selectOsImageHash(tcb);
  const measurements = registeredMeasurements(tcb, firstMeasurement(bundle));
  const assessment = assessDstack({
    measurements,
    osImageHash: selected.hash,
    osImageHashConflict: selected.conflict,
    compose,
    hasOsImageHashEvent: selected.inEventLog,
    hasRootfsHashEvent: hasEvent(tcb?.event_log, "rootfs-hash"),
    quoteVerified: registrationQuoteVerified(bundle),
  });
  if (!compose && assessment.kind === "unknown" && bundle.shade === "measurements-registry") {
    return [];
  }
  const dstack = dstackFinding(assessment);
  if (fromFile(bundle) && selected.hash) {
    dstack.plainEnglish += " The file supplied this os_image_hash. This run did not read it from chain.";
  }
  const findings: Finding[] = [dstack, upgradeFinding(bundle, assessment, now)];
  if (!compose) {
    const regMethod = bundle.shade === "shade-v1-worker" ? "register_worker" : "register_agent";
    if (!fromFile(bundle) && bundle.historyFailedMethods?.includes(regMethod)) {
      const note = ` ${bundle.historyError ?? `Could not read history for ${regMethod}.`} The registered configuration was not loaded. This is not an empty registration.`;
      for (const finding of findings) finding.plainEnglish += note;
    }
    return findings;
  }
  findings.push(imageFinding(compose));
  findings.push(logsFinding(compose));
  findings.push(sysinfoFinding(compose));
  findings.push(secretFinding(compose));
  findings.push(plaintextFinding(compose));
  findings.push(socketFinding(compose));
  findings.push(kmsFinding(compose));
  findings.push(allowedEnvsFinding(compose));
  findings.push(debugImageFinding(compose));
  return findings;
}

function dstackFinding(assessment: ReturnType<typeof assessDstack>): Finding {
  if (assessment.kind === "fixed") {
    return make(
      "dstack.range",
      "PROVEN",
      `Registered configuration is a known fixed image (${assessment.label})`,
      assessment.inference,
      assessment.detail,
      [{ label: "Fixed image list", detail: "dstack 0.5.12 (including dev and nvidia variants) and dstack 0.6.1" }],
    );
  }
  if (assessment.kind === "not-fixed-image") {
    return make(
      "dstack.range",
      "RISKY",
      "Registered os_image_hash is not a known fixed image",
      true,
      assessment.detail,
      [{ label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL }],
    );
  }
  if (assessment.kind === "declared-fixed") {
    return make(
      "dstack.range",
      "NOT_PROVEN",
      `Declared dstack_version ${assessment.label} was not compared to an os_image_hash`,
      true,
      assessment.detail,
      [{ label: "Fixed image list", detail: "A declared version is not a proven fixed image" }],
    );
  }
  if (assessment.kind === "unknown") {
    return make("dstack.range", "NOT_PROVEN", "dstack release was not proven", false, assessment.detail, [
      { label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL },
    ]);
  }
  return make(
    "dstack.range",
    "RISKY",
    "Registered configuration matches a vulnerable configuration",
    assessment.inference,
    `${assessment.detail} The fixed releases named by Phala are 0.6.1 and 0.5.12.`,
    [{ label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL }],
  );
}

function upgradeFinding(bundle: EvidenceBundle, assessment: ReturnType<typeof assessDstack>, now: Date): Finding {
  const text = upgradePlainEnglish(assessment, now, bundle.shade === "shade-v2");
  if (assessment.kind === "fixed") {
    return make("dstack.upgrade", "PROVEN", "20 Nov 2026 auto-upgrade does not apply to this fixed image", false, text, [
      { label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL },
    ]);
  }
  if (assessment.kind === "declared-fixed") {
    return make(
      "dstack.upgrade",
      "NOT_PROVEN",
      "20 Nov 2026 schedule was not cleared by a declared version",
      true,
      text,
      [{ label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL }],
    );
  }
  if (assessment.kind === "unknown") {
    return make("dstack.upgrade", "NOT_PROVEN", "20 Nov 2026 schedule could not be applied", false, text, [
      { label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL },
    ]);
  }
  return make(
    "dstack.upgrade",
    "RISKY",
    "20 Nov 2026 auto-upgrade or v0.3.x retirement may apply",
    assessment.inference,
    text,
    [{ label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL }],
  );
}

function imageFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  if (compose.images.length === 0) {
    return make(
      "images.pin",
      "NOT_PROVEN",
      "No container images were listed",
      false,
      "The registered configuration did not include an image line to check for a digest pin.",
    );
  }
  const loose = compose.images.filter((image) => !image.pinned);
  if (loose.length === 0) {
    return make(
      "images.pin",
      "PROVEN",
      "Registered images are pinned by digest",
      false,
      `All ${compose.images.length} image references in the registered configuration use a sha256 digest.`,
      compose.images.map((image) => ({ label: image.ref, detail: image.digest ?? "" })),
    );
  }
  const described = loose
    .map((image) =>
      image.tag === "latest"
        ? `${image.ref} (tag latest, not pinned by digest)`
        : `${image.ref} (tag ${image.tag}, not pinned by digest)`,
    )
    .join("; ");
  return make(
    "images.pin",
    "RISKY",
    "Registered configuration has an unpinned image",
    false,
    `An image that is not pinned by digest can move without a new registration. ${described}.`,
    loose.map((image) => ({ label: image.ref, detail: "not pinned by sha256" })),
  );
}

function logsFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  if (compose.publicLogs === true) {
    return make(
      "dstack.public_logs",
      "RISKY",
      "public_logs is true in the registered configuration",
      false,
      "The registered app compose sets public_logs to true. Phala's console template used to default this on. Treat logs from that configuration as public.",
      [{ label: "app_compose.public_logs", detail: "true" }],
    );
  }
  if (compose.publicLogs === false) {
    return make(
      "dstack.public_logs",
      "PROVEN",
      "public_logs is false in the registered configuration",
      false,
      "The registered app compose sets public_logs to false.",
    );
  }
  return make(
    "dstack.public_logs",
    "NOT_PROVEN",
    "public_logs was not in the registered configuration",
    false,
    "The configuration that was read has no public_logs field.",
  );
}

function sysinfoFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  if (compose.publicSysinfo === true) {
    return make(
      "dstack.public_sysinfo",
      "RISKY",
      "public_sysinfo is true in the registered configuration",
      false,
      "The registered app compose sets public_sysinfo to true. System information from that configuration is public.",
      [{ label: "app_compose.public_sysinfo", detail: "true" }],
    );
  }
  if (compose.publicSysinfo === false) {
    return make(
      "dstack.public_sysinfo",
      "PROVEN",
      "public_sysinfo is false in the registered configuration",
      false,
      "The registered app compose sets public_sysinfo to false.",
      [{ label: "app_compose.public_sysinfo", detail: "false" }],
    );
  }
  return make(
    "dstack.public_sysinfo",
    "NOT_PROVEN",
    "public_sysinfo was not in the registered configuration",
    false,
    "The configuration that was read has no public_sysinfo field.",
    [{ label: "app_compose.public_sysinfo", detail: "absent" }],
  );
}

function secretFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  const names = [
    ...new Set([...compose.envNames.filter(isSecretEnvName), ...compose.secrets.map((hit) => hit.name)]),
  ];
  if (names.length === 0) {
    return make(
      "dstack.secret_env",
      "PROVEN",
      "No secret-looking env names in the registered configuration",
      false,
      "Env names were checked for PRIVATE_KEY, SEED, API_KEY, ACCESS_KEY, SECRET, PASSWORD, TOKEN, and MNEMONIC. None matched. Values are not printed.",
    );
  }
  return make(
    "dstack.secret_env",
    "RISKY",
    "Registered configuration names secret-looking env vars",
    false,
    `These env names match a secret-looking pattern: ${names.join(", ")}. Glassbox reports the names only. A name in the registered configuration is not proof of the value, and the value is not shown.`,
    names.map((name) => ({ label: name, detail: "name only" })),
  );
}

function plaintextFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  const hits = compose.secrets.filter((hit) => hit.kind === "plaintext" && hit.hashPrefix);
  if (hits.length === 0) {
    return make(
      "compose.plaintext_secrets",
      "PROVEN",
      "No plaintext secret values in the registered configuration",
      false,
      "Secret-looking entries were checked for literal values. A ${NAME} reference, a $VAR reference, or a name with no value is not plaintext. No literal value is copied into this report.",
    );
  }
  const described = hits.map((hit) => `${hit.name} at ${hit.path} (sha256 ${hit.hashPrefix})`).join("; ");
  return make(
    "compose.plaintext_secrets",
    "RISKY",
    "Registered configuration has plaintext secret values",
    false,
    `Plaintext secret-looking values are in the registered configuration. Glassbox shows the key name and the first 4 hex characters of sha256(value) only. ${described}.`,
    hits.map((hit) => ({ label: hit.name, detail: `${hit.path} sha256 ${hit.hashPrefix}` })),
  );
}

function socketFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  if (compose.socketMounts.length === 0) {
    return make(
      "compose.sockets",
      "PROVEN",
      "No docker or guest-agent socket is mounted into an app",
      false,
      "Volume and device entries were checked for docker.sock, tappd.sock, and dstack.sock. None of those sockets are mounted into an app container in the registered configuration.",
    );
  }
  return make(
    "compose.sockets",
    "RISKY",
    "A docker or guest-agent socket is mounted into an app",
    false,
    `The registered configuration mounts a socket into an app container: ${compose.socketMounts.join("; ")}. A mounted docker.sock or guest-agent socket matches a vulnerable configuration.`,
    compose.socketMounts.map((mount) => ({ label: mount })),
  );
}

function kmsFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  if (compose.kmsEnabled === false) {
    return make(
      "compose.kms",
      "RISKY",
      "kms_enabled is false in the registered configuration",
      false,
      "kms_enabled is false. Env in that registered configuration is not covered by the KMS.",
      [{ label: "app_compose.kms_enabled", detail: "false" }],
    );
  }
  if (!compose.hasEncryptedEnv) {
    const kms = compose.kmsEnabled === true ? "kms_enabled is true, and the" : "The";
    return make(
      "compose.kms",
      "RISKY",
      "Registered configuration has no encrypted env",
      false,
      `${kms} registered configuration has no encrypted env field. A ${"${NAME}"} reference is not ciphertext, and this check does not print env values.`,
      [
        { label: "app_compose.kms_enabled", detail: compose.kmsEnabled === null ? "absent" : String(compose.kmsEnabled) },
        { label: "app_compose.encrypted_env", detail: "absent" },
      ],
    );
  }
  return make(
    "compose.kms",
    "PROVEN",
    "kms_enabled is not false and an encrypted env field is present",
    false,
    "The registered configuration has an encrypted env field, and kms_enabled is not false. The ciphertext is not printed.",
    [
      { label: "app_compose.kms_enabled", detail: compose.kmsEnabled === null ? "absent" : "true" },
      { label: "app_compose.encrypted_env", detail: "present" },
    ],
  );
}

function allowedEnvsFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  const list = compose.allowedEnvs;
  if (!list) {
    return make(
      "compose.allowed_envs",
      "NOT_PROVEN",
      "allowed_envs was not in the registered configuration",
      false,
      "The configuration that was read has no allowed_envs field, so this check cannot say whether host env injection is narrow.",
      [{ label: "app_compose.allowed_envs", detail: "absent" }],
    );
  }
  const broad = list.filter((entry) => entry.includes("*") || entry.trim() === "");
  const secretNames = list.filter((entry) => isSecretEnvName(entry));
  if (broad.length > 0 || secretNames.length > 0) {
    const reasons = [
      broad.length > 0 ? `wildcard or empty patterns: ${broad.join(", ") || "(empty)"}` : "",
      secretNames.length > 0 ? `secret-looking names the host may supply: ${secretNames.join(", ")}` : "",
    ].filter(Boolean);
    return make(
      "compose.allowed_envs",
      "RISKY",
      "allowed_envs is overly broad in the registered configuration",
      false,
      `allowed_envs matches an overly broad pattern (${reasons.join("; ")}). Names are shown. Values are not.`,
      [{ label: "app_compose.allowed_envs", detail: list.join(", ") }],
    );
  }
  return make(
    "compose.allowed_envs",
    "PROVEN",
    "allowed_envs lists specific names and no wildcard",
    false,
    `allowed_envs has ${list.length} entr${list.length === 1 ? "y" : "ies"} and no wildcard. None of the names match a secret-looking pattern.`,
    [{ label: "app_compose.allowed_envs", detail: list.join(", ") || "(empty)" }],
  );
}

function debugImageFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  const debug = compose.images.filter(isDebugImage);
  if (compose.images.length === 0) {
    return make(
      "compose.debug_images",
      "NOT_PROVEN",
      "No container images were listed for a debug-image check",
      false,
      "The registered configuration did not include an image line to check for a debug or dev tag.",
    );
  }
  if (debug.length === 0) {
    return make(
      "compose.debug_images",
      "PROVEN",
      "Registered images are not debug or dev images",
      false,
      "Image names and tags were checked for debug, dbg, and dev. None matched.",
      compose.images.map((image) => ({ label: image.ref })),
    );
  }
  return make(
    "compose.debug_images",
    "RISKY",
    "Registered configuration uses a debug or dev image",
    false,
    `A debug or dev image matches a vulnerable configuration: ${debug.map((image) => image.ref).join("; ")}.`,
    debug.map((image) => ({ label: image.ref, detail: image.tag ?? "name" })),
  );
}

function accessFinding(bundle: EvidenceBundle): Finding | null {
  if (!bundle.accessKeys && !bundle.accessKeyError) return null;
  const assessed = assessAccessKeys(bundle.accessKeys, bundle.accessKeyError);
  const title =
    assessed.ladder === "RISKY"
      ? "Access keys can change or broadly call the account"
      : assessed.ladder === "PROVEN"
        ? "Access keys are limited function-call keys"
        : "Access-key risk was not proven";
  const file = fromFile(bundle);
  const sentence =
    assessed.reasons.join(" ") +
    (file ? " The file supplied these keys. This run did not call view_access_key_list." : "");
  return make("access.keys", assessed.ladder, title, false, sentence, [
    {
      label: file ? "access keys in the file" : "view_access_key_list",
      detail: `${bundle.accessKeys?.length ?? 0} keys`,
    },
  ]);
}

function mpcFinding(bundle: EvidenceBundle, now: Date): Finding {
  const lists = bundle.mpc ?? [];
  const nowSec = Math.floor(now.getTime() / 1000);
  const evidence: EvidenceLink[] = lists.map((list) => ({
    label: `${list.accountId} (${list.network})`,
    url: accountUrl(list.network, list.accountId),
    detail: list.error
      ? list.error
      : list.entries
          .map((entry) => `${entry.image_hash} expiry ${formatExpiry(entry)} (${entryExpiry(entry, nowSec)})`)
          .join("; ") || "empty allowlist",
  }));
  evidence.push({ label: "Related work", url: MEASURE_REPO_URL, detail: "dreyyyy1/measure" });
  if (lists.length === 0 || lists.every((list) => list.error)) {
    return make(
      "mpc.allowlist",
      "NOT_PROVEN",
      "MPC docker allowlist was not read",
      false,
      "allowed_docker_image_hashes on v1.signer and v1.signer-prod.testnet was not available.",
      evidence,
    );
  }
  const digests = (bundle.compose?.images ?? []).map((image) => image.digest).filter((digest): digest is string => Boolean(digest));
  const hits = matchingDigests(digests, lists);
  const snapshot = bundle.mpcFromSnapshot ? " These rows came from a captured snapshot, not a new read." : "";
  if (bundle.shade === "mpc-signer") {
    const expired = lists.flatMap((list) => list.entries.filter((entry) => entryExpiry(entry, nowSec) === "expired"));
    if (expired.length > 0) {
      return make(
        "mpc.allowlist",
        "RISKY",
        "An MPC allowlist entry is past its expiry",
        false,
        `${expired.length} allowed_docker_image_hashes entry is past its expiry. The view still returns it.${snapshot}`,
        evidence,
      );
    }
    const count = lists.reduce((sum, list) => sum + list.entries.length, 0);
    return make(
      "mpc.allowlist",
      "PROVEN",
      "MPC allowlist was read",
      false,
      `allowed_docker_image_hashes returned ${count} entries across the signer contracts that answered. No returned entry is past its expiry.${snapshot}`,
      evidence,
    );
  }
  if (hits.length === 0) {
    return make(
      "mpc.allowlist",
      "NOT_PROVEN",
      "Registered image digests were not on the MPC allowlist",
      false,
      digests.length === 0
        ? `No pinned image digest was available to compare with allowed_docker_image_hashes. The allowlist is a different contract's docker list.${snapshot}`
        : `None of the pinned image digests in the registered configuration appear on v1.signer or v1.signer-prod.testnet. That list is a different system's docker allowlist. Absence here is not a judgement of the Shade registration.${snapshot}`,
      evidence,
    );
  }
  const expiredHit = hits.find((hit) => entryExpiry(hit.entry, nowSec) === "expired");
  if (expiredHit) {
    return make(
      "mpc.allowlist",
      "RISKY",
      "A pinned digest matches an expired MPC allowlist entry",
      false,
      `Digest ${expiredHit.digest} is on ${expiredHit.list.accountId}, and that entry expired at ${formatExpiry(expiredHit.entry)}.${snapshot}`,
      evidence,
    );
  }
  return make(
    "mpc.allowlist",
    "PROVEN",
    "A pinned digest is on the MPC allowlist",
    false,
    hits
      .map((hit) => `Digest ${hit.digest} is on ${hit.list.accountId} (${hit.list.network}) and the entry is not expired.`)
      .join(" ") + snapshot,
    evidence,
  );
}

function shadeFinding(bundle: EvidenceBundle): Finding {
  if (bundle.shade === "unknown") {
    const evidence = codeEvidence(bundle).filter((item) => !(fromFile(bundle) && item.label === "Account"));
    return make(
      "shade.interface",
      "NOT_PROVEN",
      "Contract interface was not recognised",
      false,
      bundle.shadeDetail,
      evidence,
    );
  }
  return make("shade.interface", "PROVEN", `Account interface is ${bundle.shade}`, false, bundle.shadeDetail, [
    ...codeEvidence(bundle),
    { label: "View methods present", detail: bundle.methodsPresent.join(", ") || "(none probed)" },
  ]);
}

function runtimeFinding(): Finding {
  return make(
    "runtime.observed",
    "NOT_PROVEN",
    "What the account is executing now was not observed",
    false,
    "Glassbox did not take a live guest quote. Phala blocks public guest-agent routes by default, and a reachable endpoint would still be a different fact from the registered configuration.",
    [{ label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL, detail: "public guest-agent routes blocked by default" }],
  );
}

function signatureFinding(bundle: EvidenceBundle, stored: ReturnType<typeof verifyQuoteAt> | null): Finding {
  const version = verifierMetadata().version;
  if (!stored) {
    return make(
      "tdx.signature",
      "NOT_PROVEN",
      "Quote signature was not checked",
      false,
      "The registration quote was loaded without the collateral stored beside it, so the quote signature was not checked.",
      txEvidence(bundle),
    );
  }
  if (!stored.ok) {
    return make(
      "tdx.signature",
      "NOT_PROVEN",
      "Quote signature did not verify",
      false,
      `The quote signature did not verify against the stored collateral with @phala/dcap-qvl ${version}. ${clip(stored.error ?? "No status was returned.")}`,
      txEvidence(bundle),
    );
  }
  return make(
    "tdx.signature",
    "PROVEN",
    "Quote signature verified",
    false,
    `The quote signature verified with @phala/dcap-qvl ${version} against the collateral stored with the registration.${
      fromFile(bundle) ? " The quote and the collateral came from this file. This run did not fetch them from chain." : ""
    }`,
    txEvidence(bundle),
  );
}

function qeIdentityFinding(bundle: EvidenceBundle, stored: ReturnType<typeof verifyQuoteAt> | null): Finding {
  const meta = verifierMetadata();
  if (meta.version !== DCAP_QVL_VERSION || meta.qeIdentity !== "mandatory") {
    return make(
      "tdx.qe_identity",
      "RISKY",
      "QE identity is not mandatory in this verifier",
      false,
      `Installed @phala/dcap-qvl ${meta.version} is older than 0.3.9. QE identity verification is not mandatory in that build (GHSA-796p-j2gh-9m2q).`,
      txEvidence(bundle),
    );
  }
  if (!stored) {
    return make(
      "tdx.qe_identity",
      "NOT_PROVEN",
      "QE identity was not checked",
      false,
      `QE identity verification is mandatory in @phala/dcap-qvl ${meta.version}, and the stored collateral was not available to run it.`,
      txEvidence(bundle),
    );
  }
  if (!stored.ok) {
    const qeError = stored.error && /qe[_\s-]?identity|qe mrsigner|qe isvprodid|qe isvsvn|unsupported qe/i.test(stored.error);
    return make(
      "tdx.qe_identity",
      qeError ? "RISKY" : "NOT_PROVEN",
      qeError ? "QE identity did not match the quote" : "QE identity was not accepted",
      false,
      qeError
        ? `QE identity is mandatory in @phala/dcap-qvl ${meta.version}, and this quote did not satisfy it. ${clip(stored.error ?? "")}`
        : `QE identity is mandatory in @phala/dcap-qvl ${meta.version} (the check has been part of verification since 0.3.9, GHSA-796p-j2gh-9m2q). Verification did not complete, so QE identity was not accepted. ${clip(stored.error ?? "")}`,
      txEvidence(bundle),
    );
  }
  return make(
    "tdx.qe_identity",
    "PROVEN",
    "QE identity verified",
    false,
    `QE identity is mandatory in @phala/dcap-qvl ${meta.version} (GHSA-796p-j2gh-9m2q, fixed in 0.3.9). This quote verified, so the QE identity signature, issuer chain, and MRSIGNER, ISVPRODID, and ISVSVN policy were checked. The check is not optional.`,
    txEvidence(bundle),
  );
}

function registrationTcbFinding(
  bundle: EvidenceBundle,
  stored: ReturnType<typeof verifyQuoteAt> | null,
  when: string,
): Finding {
  if (!stored) {
    return make(
      "tdx.registration",
      "NOT_PROVEN",
      "TCB status at registration was not checked",
      false,
      "The registration quote was loaded without the collateral stored beside it, so the TCB status at registration was not checked. TCB status is a verdict in this report. It is not informational.",
      txEvidence(bundle),
    );
  }
  if (!stored.ok || !stored.status) {
    return make(
      "tdx.registration",
      "NOT_PROVEN",
      "TCB status at registration was not accepted",
      false,
      `The quote did not verify against the stored collateral, so the TCB status at registration was not accepted. ${clip(stored.error ?? "No status was returned.")} TCB status is a verdict in this report. It is not informational.`,
      txEvidence(bundle),
    );
  }
  const proven = stored.status === "UpToDate";
  return make(
    "tdx.registration",
    proven ? "PROVEN" : "RISKY",
    proven ? "TCB status at registration is UpToDate" : `TCB status at registration is ${stored.status}`,
    false,
    `The registered configuration's TCB status ${when} is ${stored.status}. TCB status is a verdict in this report. It is not informational.`,
    txEvidence(bundle),
  );
}

export function freshTcbFinding(bundle: EvidenceBundle, fresh: ReturnType<typeof verifyQuoteAt> | null): Finding {
  const evidence: EvidenceLink[] = [{ label: "Phala PCCS", url: PINNED_PCCS_URL, detail: "allowlisted; caller URLs are not accepted" }];
  if (bundle.freshCollateral) {
    if (!fresh?.ok || !fresh.status) {
      return make(
        "tdx.fresh",
        "NOT_PROVEN",
        "TCB status now was not accepted",
        false,
        `A fresh collateral bundle was fetched from the allowlisted PCCS, and the quote did not verify against it. ${clip(fresh?.error ?? "")}`.trim(),
        evidence,
        "collateral-freshness",
      );
    }
    const proven = fresh.status === "UpToDate";
    return make(
      "tdx.fresh",
      proven ? "PROVEN" : "RISKY",
      proven ? "Registered configuration's TCB is now UpToDate" : `Registered configuration's TCB is now ${fresh.status}`,
      false,
      `The registered configuration's TCB is now ${fresh.status}. This is the same registered quote checked against fresh collateral from the allowlisted PCCS. It is not a new quote from a live guest. TCB status is a verdict in this report. It is not informational.`,
      evidence,
      "collateral-freshness",
    );
  }
  return make(
    "tdx.fresh",
    "NOT_PROVEN",
    "TCB status now was not checked",
    false,
    bundle.freshCollateralError
      ? `Fresh collateral was not fetched (${bundle.freshCollateralError}), so the registered configuration's TCB status now was not checked.`
      : "Fresh collateral was not attached, so the registered configuration's TCB status now was not checked.",
    evidence,
    "collateral-freshness",
  );
}

function advisoryFinding(
  bundle: EvidenceBundle,
  stored: ReturnType<typeof verifyQuoteAt> | null,
  fresh: ReturnType<typeof verifyQuoteAt> | null,
): Finding {
  const ids = [
    ...new Set([...(stored?.ok ? stored.advisoryIds : []), ...(fresh?.ok ? fresh.advisoryIds : [])]),
  ];
  if (!stored?.ok && !fresh?.ok) {
    return make(
      "tdx.advisories",
      "NOT_PROVEN",
      "Advisory IDs were not read",
      false,
      "Advisory IDs were not read because the quote did not verify against the collateral that was available.",
      txEvidence(bundle),
    );
  }
  if (ids.length === 0) {
    return make(
      "tdx.advisories",
      "PROVEN",
      "No advisory IDs were returned",
      false,
      "No advisory IDs were returned for the TCB levels that verified.",
      txEvidence(bundle),
    );
  }
  return make(
    "tdx.advisories",
    "RISKY",
    "Advisory IDs are attached to the registered configuration",
    false,
    `Advisory IDs on the registered configuration: ${ids.join(", ")}. These are Intel's identifiers for the matched TCB level.`,
    [...advisoryEvidence(ids), ...txEvidence(bundle)],
  );
}

function fromFile(bundle: EvidenceBundle): boolean {
  return bundle.historySource === "file";
}

function missingQuoteText(bundle: EvidenceBundle): string {
  const regMethod = bundle.shade === "shade-v1-worker" ? "register_worker" : "register_agent";
  let text: string;
  if (!fromFile(bundle) && bundle.historyFailedMethods?.includes(regMethod)) {
    text = `${bundle.historyError ?? `Could not read history for ${regMethod}.`} The registration quote was not loaded. A failed history read is not an empty index.`;
  } else if (bundle.registrationArgsUnreadable) {
    text = "The registration transaction was found, but its arguments could not be read, so the TDX quote was not verified.";
  } else if (bundle.registration) {
    text = "A registration record was found, but it did not include a TDX quote.";
  } else {
    text = "No successful register_agent or register_worker arguments were loaded, so the TDX quote was not verified.";
  }
  return withRegistrationCache(bundle, text);
}

function withRegistrationCache(bundle: EvidenceBundle, text: string): string {
  if (bundle.registrationHistoryCacheAgeMs === undefined) return text;
  return `${text} The registration transaction was chosen from a local history cache (${formatHistoryCacheAge(bundle.registrationHistoryCacheAgeMs)} old).`;
}

function noteRegistrationCache(bundle: EvidenceBundle, finding: Finding): Finding {
  if (bundle.registrationHistoryCacheAgeMs === undefined) return finding;
  return { ...finding, plainEnglish: withRegistrationCache(bundle, finding.plainEnglish) };
}

function withCodehashCache(bundle: EvidenceBundle, text: string): string {
  if (fromFile(bundle) || bundle.codehashHistoryCacheAgeMs === undefined) return text;
  return `${text} The approve_codehash history was served from a local cache (${formatHistoryCacheAge(bundle.codehashHistoryCacheAgeMs)} old), not a new read.`;
}

function clip(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
}

function advisoryEvidence(ids: string[]): EvidenceLink[] {
  return ids.map((id) => ({ label: id, url: advisoryUrl(id) }));
}

function txEvidence(bundle: EvidenceBundle): EvidenceLink[] {
  if (!bundle.registration?.txHash || bundle.network === "offline") {
    return bundle.registration?.txHash ? [{ label: "Registration transaction", detail: bundle.registration.txHash }] : [];
  }
  return [{ label: "Registration transaction", url: txUrl(bundle.network, bundle.registration.txHash), detail: bundle.registration.txHash }];
}

function countEvidence(bundle: EvidenceBundle): EvidenceLink[] {
  return [
    {
      label: "Registration history",
      detail: `${bundle.registrationCount ?? 0} successful, ${bundle.failedRegistrationCount ?? 0} failed`,
    },
  ];
}

function codeEvidence(bundle: EvidenceBundle): EvidenceLink[] {
  const evidence: EvidenceLink[] = [];
  if (bundle.network !== "offline") {
    evidence.push({ label: "Account", url: accountUrl(bundle.network, bundle.target) });
  }
  if (bundle.codeHash) evidence.push({ label: "code_hash", detail: bundle.codeHash });
  if (bundle.globalContractHash) evidence.push({ label: "global_contract_hash", detail: bundle.globalContractHash });
  return evidence;
}

function sourceLines(bundle: EvidenceBundle): string[] {
  const meta = verifierMetadata();
  const lines = [
    `@phala/dcap-qvl ${meta.version} (Apache-2.0) for TDX quote verification. QE identity is ${meta.qeIdentity}. TCB status is ${meta.tcbStatus}. PCCS allowlist: ${meta.pccsAllowlist.join(", ")}.`,
  ];
  if (bundle.rpcEndpoints.length > 0) lines.push(`NEAR RPC: ${[...new Set(bundle.rpcEndpoints)].join(", ")}`);
  if (bundle.historySource === "nearblocks") lines.push("Transaction history: NearBlocks API.");
  if (bundle.historySource === "fastnear") lines.push("Transaction history: FastNEAR tx API.");
  if (bundle.historySource === "file") lines.push("Input: local JSON. Chain history was not queried.");
  lines.push("Shade measurement tables: shade-agent-cli (Apache-2.0), dstack 0.5.7 and 0.5.8 only.");
  lines.push(PHALA_POSTMORTEM_URL);
  lines.push(`TEE.fail: ${TEE_FAIL_URL}`);
  return lines;
}

function provenanceFinding(bundle: EvidenceBundle): Finding {
  const tcb = bundle.registration?.tcbInfo;
  const selected = selectOsImageHash(tcb);
  const measurements = registeredMeasurements(tcb, firstMeasurement(bundle));
  const assessment = assessProvenance({
    osImageHash: selected.hash,
    osImageHashConflict: selected.conflict,
    fixedImageAttested: selected.inEventLog && registrationQuoteVerified(bundle),
    ...measurements,
  });
  const regMethod = bundle.shade === "shade-v1-worker" ? "register_worker" : "register_agent";
  const unread =
    !fromFile(bundle) && !tcb && bundle.historyFailedMethods?.includes(regMethod)
      ? `${bundle.historyError ?? `Could not read history for ${regMethod}.`} The registered measurements were not loaded. This is not an empty measurement. `
      : "";
  const detail = fromFile(bundle)
    ? `${assessment.detail} The file supplied these measurement fields. This run did not read them from chain.`
    : `${unread}${assessment.detail}`;
  return make(
    "measurements.provenance",
    assessment.ladder,
    assessment.title,
    assessment.inference,
    detail,
    assessment.evidence.map((item) => ({ label: item.label, detail: item.detail })),
  );
}

function registeredMeasurements(
  tcb: { mrtd?: string; rtmr0?: string; rtmr1?: string; rtmr2?: string } | null | undefined,
  row: { mrtd?: string; rtmr0?: string; rtmr1?: string; rtmr2?: string } | null,
): { mrtd?: string; rtmr0?: string; rtmr1?: string; rtmr2?: string } {
  if (tcb?.mrtd || tcb?.rtmr0 || tcb?.rtmr1 || tcb?.rtmr2) {
    return { mrtd: tcb.mrtd, rtmr0: tcb.rtmr0, rtmr1: tcb.rtmr1, rtmr2: tcb.rtmr2 };
  }
  return { mrtd: row?.mrtd, rtmr0: row?.rtmr0, rtmr1: row?.rtmr1, rtmr2: row?.rtmr2 };
}

function firstMeasurement(bundle: EvidenceBundle): {
  osImageHash?: string;
  mrtd?: string;
  rtmr0?: string;
  rtmr1?: string;
  rtmr2?: string;
} | null {
  const agent = bundle.v2Agents?.[0];
  if (!agent) return null;
  return {
    mrtd: agent.measurements.mrtd,
    rtmr0: agent.measurements.rtmr0,
    rtmr1: agent.measurements.rtmr1,
    rtmr2: agent.measurements.rtmr2,
  };
}

function contractFindings(bundle: EvidenceBundle): Finding[] {
  const historyLoaded = bundle.approvalHistory !== undefined;
  const approver = assessApprover({
    shade: bundle.shade,
    target: bundle.target,
    ownerId: bundle.ownerId,
    accessKeys: bundle.accessKeys,
    accessKeyError: bundle.accessKeyError,
    approvalHistory: bundle.approvalHistory,
    historyLoaded,
    historyFailedMethods: bundle.historyFailedMethods,
  });
  const removed = assessRemove({
    shade: bundle.shade,
    changeMethods: bundle.changeMethods,
    approvalHistory: bundle.approvalHistory,
    historyLoaded,
    historyFailedMethods: bundle.historyFailedMethods,
  });
  const code = assessContractCode({
    codeHash: bundle.codeHash,
    globalContractHash: bundle.globalContractHash,
  });
  if (fromFile(bundle) && bundle.codeHash) {
    code.plainEnglish += " The file supplied this code_hash. This run did not call view_account.";
  }
  if (fromFile(bundle) && approver.ladder === "PROVEN") {
    approver.plainEnglish += " The file supplied the owner and keys compared here. This run did not call those views.";
  }
  if (fromFile(bundle) && removed.ladder === "PROVEN") {
    removed.plainEnglish += " The file supplied the method probe or history compared here. This run did not call the contract.";
  }
  return [approver, removed, code].map((item) =>
    make(item.id, item.ladder, item.title, item.inference, item.plainEnglish, item.evidence),
  );
}

function freshnessFinding(bundle: EvidenceBundle, now: Date): Finding {
  const freshness = reportFreshness(bundle, now);
  const regMethod = bundle.shade === "shade-v1-worker" ? "register_worker" : "register_agent";
  const registrationUnread = !fromFile(bundle) && bundle.historyFailedMethods?.includes(regMethod) && !freshness.registrationTime;
  const when = freshness.registrationTime
    ? `The registration time is ${freshness.registrationTime}. The attestation age at ${now.toISOString()} is ${freshness.attestationAge ?? "unreadable"}.`
    : registrationUnread
      ? `${bundle.historyError ?? `Could not read history for ${regMethod}.`} Registration time was not loaded, so attestation age was not computed.`
      : "Registration time was not loaded, so attestation age was not computed.";
  const until =
    freshness.validUntil.length > 0
      ? ` The contract view names valid_until_ms for ${freshness.validUntil.map((item) => `${item.accountId} (${item.validUntil})`).join(", ")}.`
      : bundle.v2Agents && bundle.v2Agents.length > 0
        ? " valid_until_ms was not in the agent view."
        : " valid_until_ms applies to a Shade v2 agent view, and this report has none.";
  return make(
    "freshness.registration",
    "NOT_PROVEN",
    "Attestation is proven at registration only",
    false,
    `${when}${until} ${freshness.live.detail}`,
    [{ label: "Phala post-mortem", url: PHALA_POSTMORTEM_URL, detail: "public guest-agent routes blocked by default" }],
  );
}

function reportFreshness(bundle: EvidenceBundle, now: Date): Freshness {
  const seconds = bundle.registration?.timestampSec;
  const registrationTime = typeof seconds === "number" ? (isoFromUnixMs(seconds * 1000) ?? null) : null;
  const attestationAge = typeof seconds === "number" && registrationTime ? formatAge(seconds, now) : null;
  const validUntil = (bundle.v2Agents ?? [])
    .filter((agent) => agent.validUntilMs !== undefined)
    .map((agent) => ({
      accountId: agent.accountId,
      validUntil: isoFromUnixMs(agent.validUntilMs ?? 0) ?? "unreadable",
    }));
  return {
    registrationTime,
    attestationAge,
    validUntil,
    provenAtRegistrationOnly: true,
    live: bundle.live ?? unattemptedLiveObservation(),
  };
}

function formatAge(fromSec: number, now: Date): string {
  const ms = now.getTime() - fromSec * 1000;
  if (!Number.isFinite(ms)) return "unreadable";
  if (ms < 0) return "the registration time is after this report";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hours`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} minutes`;
}

function reportFacts(bundle: EvidenceBundle): ReportFacts {
  const tcb = bundle.registration?.tcbInfo;
  const selected = selectOsImageHash(tcb);
  const measurements = registeredMeasurements(tcb, firstMeasurement(bundle));
  return {
    appComposeSha256: bundle.registration?.appComposeSha256 ?? null,
    appCodehash: bundle.agentView?.codehash ?? null,
    contractCodeHash: bundle.codeHash ?? null,
    osImageHash: selected.conflict ? null : selected.hash ?? null,
    mrtd: measurements.mrtd ?? null,
    rtmr0: measurements.rtmr0 ?? null,
    rtmr1: measurements.rtmr1 ?? null,
    rtmr2: measurements.rtmr2 ?? null,
    publicLogs: bundle.compose?.publicLogs ?? null,
    publicSysinfo: bundle.compose?.publicSysinfo ?? null,
    images: (bundle.compose?.images ?? []).map((image) => image.ref),
    dstackVersion: bundle.compose?.versionDeclared ? bundle.compose.dstackVersion : null,
    secretEnvNames: (bundle.compose?.envNames ?? []).filter(isSecretEnvName),
  };
}

function reportInputs(bundle: EvidenceBundle): ReportInputs {
  const height = bundle.registration?.blockHeight;
  let collateralSource: ReportInputs["collateralSource"] = "none";
  if (bundle.registration?.collateral !== undefined) {
    collateralSource = bundle.historySource === "file" ? "file" : "registration";
  }
  return {
    contract: bundle.target,
    agent: bundle.registration?.agentId ?? null,
    txHash: bundle.registration?.txHash ?? null,
    blockHeight: typeof height === "number" ? height : null,
    collateralSource,
    collateralFetchedAt: bundle.collateralFetchedAt ?? null,
    freshCollateralSource: bundle.freshCollateral ? PINNED_PCCS_URL : null,
  };
}

function attributionLines(bundle: EvidenceBundle): string[] {
  if (bundle.historySource !== "nearblocks") return [];
  return ["Powered by Nearblocks.io APIs."];
}

function registrationQuoteVerified(bundle: EvidenceBundle): boolean {
  const registration = bundle.registration;
  if (!registration?.quoteHex || !registration.collateral) return false;
  const when =
    typeof registration.timestampSec === "number"
      ? registration.timestampSec
      : fallbackCollateralTime(registration.collateral);
  return verifyQuoteAt(registration.quoteHex, registration.collateral, when).ok === true;
}

function fallbackCollateralTime(collateral: unknown): number {
  const record = collateral && typeof collateral === "object" ? (collateral as { tcb_info?: unknown }) : {};
  let tcb: unknown = record.tcb_info;
  if (typeof tcb === "string") {
    try {
      tcb = JSON.parse(tcb) as unknown;
    } catch {
      tcb = null;
    }
  }
  const issue = tcb && typeof tcb === "object" ? (tcb as { tcbInfo?: { issueDate?: string } }).tcbInfo?.issueDate : undefined;
  if (issue) {
    const ms = Date.parse(issue);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return Math.floor(Date.parse("2025-01-01T00:00:00Z") / 1000);
}

function presentNonDigest(values: (string | null | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0 && !isDigest(value)) return value;
  }
  return undefined;
}

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function make(
  id: string,
  ladder: Ladder,
  title: string,
  inference: boolean,
  plainEnglish: string,
  evidence: EvidenceLink[] = [],
  lane?: Finding["lane"],
): Finding {
  return {
    id,
    ladder,
    ...(lane ? { lane } : {}),
    title,
    inference,
    plainEnglish,
    evidence,
    provenance: {
      evidenceSource: "unavailable",
      observationKind: "unavailable",
      liveChain: false,
      label: "Provenance was not attached.",
    },
  };
}
