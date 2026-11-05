import { isSecretEnvName } from "./evidence/compose.js";
import { isZeroMeasurement, measurementsMatch } from "./evidence/measurements.js";
import { eventPayload, hasEvent } from "./evidence/registration.js";
import { assessAccessKeys } from "./checks/access-keys.js";
import { assessDstack } from "./checks/dstack.js";
import { entryExpiry, formatExpiry, matchingDigests } from "./checks/mpc.js";
import { measurementsEqual, replayAll } from "./checks/rtmr.js";
import { verifyQuoteAt } from "./checks/tdx.js";
import { upgradePlainEnglish } from "./checks/upgrade.js";
import { matchShadeMeasurements } from "./data/shade-measurements.js";
import {
  GLASSBOX_VERSION,
  MEASURE_REPO_URL,
  PHALA_POSTMORTEM_URL,
  accountUrl,
  advisoryUrl,
  isoFromUnixMs,
  txUrl,
  type ApprovedMeasurementRow,
  type EvidenceBundle,
  type EvidenceLink,
  type Finding,
  type Ladder,
  type Measurements,
  type Report,
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

export function buildReport(bundle: EvidenceBundle, options?: { now?: Date }): Report {
  const now = options?.now ?? new Date(bundle.generatedAt);
  const findings = [
    runtimeFinding(),
    shadeFinding(bundle),
    ...attestationFindings(bundle, now),
    ...approvalFindings(bundle, now),
    ...composeFindings(bundle, now),
    accessFinding(bundle),
    mpcFinding(bundle, now),
  ].filter((finding): finding is Finding => finding !== null);

  findings.sort((a, b) => LADDER_ORDER.indexOf(a.ladder) - LADDER_ORDER.indexOf(b.ladder) || a.id.localeCompare(b.id));

  const summary = {
    proven: findings.filter((finding) => finding.ladder === "PROVEN").length,
    notProven: findings.filter((finding) => finding.ladder === "NOT_PROVEN").length,
    risky: findings.filter((finding) => finding.ladder === "RISKY").length,
  };
  const overall: Ladder = summary.risky > 0 ? "RISKY" : summary.notProven > 0 ? "NOT_PROVEN" : "PROVEN";

  return {
    tool: "glassbox",
    version: GLASSBOX_VERSION,
    target: bundle.target,
    network: bundle.network,
    shade: bundle.shade,
    generatedAt: bundle.generatedAt,
    summary,
    overall,
    overallPlainEnglish: `Highest rung on this ladder is ${overall.replace("_", " ")} (${summary.risky} risky, ${summary.notProven} not proven, ${summary.proven} proven). That is the strongest concern already listed. It is not a separate check.`,
    findings,
    approvalHistory: bundle.approvalHistory ?? [],
    approvalHistoryNote: bundle.approvalHistoryNote,
    limitations: [
      "Findings that cite a quote or an app compose describe the registered configuration. They do not establish what the account is executing now.",
      "Glassbox does not judge payment correctness. That is Gideon, a separate NEAR pre-send checker by the same builder.",
      "Comparisons with Shade's 0.5.7/0.5.8 table use that project's published measurements. Heuristics are marked on the finding.",
    ],
    sources: sourceLines(bundle),
    attribution: attributionLines(bundle),
  };
}

export function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push("Glassbox report");
  lines.push(`Target:     ${report.target}`);
  lines.push(`Network:    ${report.network}`);
  lines.push(`Interface:  ${report.shade}`);
  lines.push(`Generated:  ${report.generatedAt}`);
  lines.push("");
  lines.push(
    `Summary: ${report.summary.risky} risky, ${report.summary.notProven} not proven, ${report.summary.proven} proven.`,
  );
  lines.push(report.overallPlainEnglish);
  lines.push(
    "This report describes the registered configuration. It does not establish what the account is executing now.",
  );
  lines.push("");
  for (const ladder of LADDER_ORDER) {
    const group = report.findings.filter((finding) => finding.ladder === ladder);
    if (group.length === 0) continue;
    lines.push(ladder.replace("_", " "));
    group.forEach((finding, index) => {
      lines.push(`${index + 1}. ${finding.title}`);
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
    });
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
  return lines.join("\n").trimEnd() + "\n";
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
        registration
          ? "A registration record was found, but it did not include a TDX quote."
          : `No successful register_agent or register_worker arguments were loaded, so the TDX quote was not verified.${bundle.historyError ? ` History error: ${bundle.historyError}` : ""}`,
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
  if (!stored) {
    findings.push(
      make(
        "tdx.registration",
        "NOT_PROVEN",
        "Stored collateral was not available",
        false,
        "The registration quote was loaded without the collateral stored beside it, so the signature and TCB status at registration were not checked.",
        txEvidence(bundle),
      ),
    );
  } else if (!stored.ok || !stored.status) {
    findings.push(
      make(
        "tdx.registration",
        "NOT_PROVEN",
        "Registration quote did not verify",
        false,
        `The quote submitted with the registration did not verify against the stored collateral. ${stored.error ?? "No status was returned."}`,
        txEvidence(bundle),
      ),
    );
  } else {
    const judged = judgeTcb(stored.status, stored.advisoryIds, when);
    findings.push(
      make(
        "tdx.registration",
        judged.ladder,
        judged.ladder === "PROVEN" ? "Registration quote verifies" : `Registration TCB status is ${stored.status}`,
        false,
        judged.text,
        [...txEvidence(bundle), ...advisoryEvidence(stored.advisoryIds)],
      ),
    );
  }

  if (bundle.freshCollateral) {
    const fresh = verifyQuoteAt(registration.quoteHex, bundle.freshCollateral, Math.floor(now.getTime() / 1000));
    if (!fresh.ok || !fresh.status) {
      findings.push(
        make(
          "tdx.fresh",
          "NOT_PROVEN",
          "Fresh collateral check did not finish",
          false,
          `A fresh collateral bundle was fetched, and the quote did not verify against it. ${fresh.error ?? ""}`.trim(),
          [{ label: "Phala PCCS", url: "https://pccs.phala.network" }],
        ),
      );
    } else {
      const judged = judgeTcb(fresh.status, fresh.advisoryIds, "against fresh collateral");
      findings.push(
        make(
          "tdx.fresh",
          judged.ladder,
          judged.ladder === "PROVEN" ? "Fresh collateral still says UpToDate" : `Fresh collateral TCB status is ${fresh.status}`,
          false,
          `${judged.text} This is the registered quote checked again, not a new quote from a live guest.`,
          [...advisoryEvidence(fresh.advisoryIds), { label: "Phala PCCS", url: "https://pccs.phala.network" }],
        ),
      );
    }
  } else {
    findings.push(
      make(
        "tdx.fresh",
        "NOT_PROVEN",
        "Fresh collateral was not checked",
        false,
        bundle.freshCollateralError
          ? `Fresh collateral was not fetched (${bundle.freshCollateralError}), so the TCB status against today's collateral was not checked.`
          : "Fresh collateral was not attached, so the TCB status against today's collateral was not checked.",
        [{ label: "Phala PCCS", url: "https://pccs.phala.network" }],
      ),
    );
  }

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
    return make(
      "tdx.report_data",
      "PROVEN",
      "Quote report data binds the registering account",
      false,
      `The quote's report data is the ASCII account id ${agent}, the same account that submitted the registration.`,
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
  const recorded = bundle.registration?.appComposeSha256;
  const redacted = bundle.registration?.appComposeRedacted === true;
  if (recorded && sameHex(recorded, payload)) {
    const sentence = redacted
      ? `The compose-hash event payload equals the sha256 recorded for the on-chain app_compose string (${payload}). Secret-looking values were removed from the local copy, so this match is against the chain string, not against that redacted copy.`
      : `sha256 of the registered app_compose string equals the compose-hash event payload (${payload}).`;
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
  if (bundle.shade === "shade-v1" || bundle.shade === "shade-v1-worker") {
    findings.push(codehashFinding(bundle));
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
  if (bundle.approvedMeasurements && bundle.approvedMeasurements.length > 0) {
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
  const invalid = agents.filter((agent) => !agent.valid);
  if (expired.length === 0 && invalid.length === 0) {
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

function codehashFinding(bundle: EvidenceBundle): Finding {
  const codehash = bundle.agentView?.codehash?.toLowerCase();
  const approved = bundle.approvedCodehashes ?? [];
  const network = bundle.network === "offline" ? "testnet" : bundle.network;
  if (!codehash) {
    return make(
      "codehash.approved",
      "NOT_PROVEN",
      "Agent codehash was not loaded",
      false,
      "get_agent did not return a codehash, so it was not compared with approve_codehash history.",
    );
  }
  const hit = approved.find((row) => row.codehash.toLowerCase() === codehash);
  if (hit) {
    const evidence: EvidenceLink[] = [
      { label: "get_agent codehash", detail: codehash },
    ];
    if (hit.txHash && bundle.network !== "offline") {
      evidence.push({ label: "approve_codehash transaction", url: txUrl(network, hit.txHash), detail: hit.txHash });
    } else if (hit.txHash) {
      evidence.push({ label: "approve_codehash transaction", detail: hit.txHash });
    }
    return make(
      "codehash.approved",
      "PROVEN",
      "App codehash is in approve_codehash history",
      false,
      `get_agent returns codehash ${codehash}, and an approve_codehash transaction records that same value. On Shade v1 this is the app image digest, not a TDX measurement.`,
      evidence,
    );
  }
  return make(
    "codehash.approved",
    "NOT_PROVEN",
    "App codehash was not seen in approve_codehash history",
    false,
    `get_agent returns codehash ${codehash}. It was not in the approve_codehash history returned for this account. That index can be incomplete, so this is not proof the codehash was never approved.`,
    [{ label: "approve_codehash rows scanned", detail: String(approved.length) }],
  );
}

function measurementListFinding(bundle: EvidenceBundle): Finding {
  const rows = bundle.approvedMeasurements ?? [];
  const registered = registeredMeasurementRows(bundle);
  if (registered.length > 0) {
    const misses = registered.filter((candidate) => !rows.some((row) => measurementsMatch(row, candidate)));
    if (misses.length === 0) {
      return make(
        "measurements.approved",
        "PROVEN",
        "Registered measurements are on the approved list",
        false,
        bundle.v2Agents?.length
          ? `Each registered agent's MRTD, RTMR0 through RTMR2, key-provider digest, and app-compose hash match a row from get_approved_measurements (${registered.length} agent${registered.length === 1 ? "" : "s"}).`
          : "The registered MRTD and RTMR0 through RTMR2 match a row from the contract's approved-measurements view.",
        bundle.v2Agents?.map((agent) => ({ label: agent.accountId, detail: agent.validity })) ?? [],
      );
    }
    return make(
      "measurements.approved",
      "RISKY",
      "Registered measurements are not on the approved list",
      false,
      `The contract published ${rows.length} approved measurement row${rows.length === 1 ? "" : "s"}, and ${misses.length} registered measurement set${misses.length === 1 ? " is" : "s are"} not on it.`,
      [{ label: "Approved rows", detail: String(rows.length) }],
    );
  }
  const tableHits = rows.filter((row) => matchShadeMeasurements(row));
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
    `${rows.length} approved measurement rows were read. None of the RTMR1/RTMR2 pairs are in Shade's 0.5.7 or 0.5.8 tables, and this view did not include an os_image_hash. The dstack release of those rows is not proven. Unknown is not a claim that the rows are fixed.`,
    [{ label: "Approved rows", detail: String(rows.length) }],
  );
}

function composeFindings(bundle: EvidenceBundle, now: Date): Finding[] {
  if (bundle.shade === "mpc-signer") return [];
  const compose = bundle.compose;
  const tcb = bundle.registration?.tcbInfo;
  const osHash = tcb?.os_image_hash ?? eventPayload(tcb?.event_log, "os-image-hash");
  const measurements: Measurements = {
    mrtd: tcb?.mrtd,
    rtmr0: tcb?.rtmr0,
    rtmr1: tcb?.rtmr1,
    rtmr2: tcb?.rtmr2,
    rtmr3: tcb?.rtmr3,
  };
  const assessment = assessDstack({
    measurements,
    osImageHash: osHash,
    compose,
    hasOsImageHashEvent: hasEvent(tcb?.event_log, "os-image-hash"),
    hasRootfsHashEvent: hasEvent(tcb?.event_log, "rootfs-hash"),
  });
  if (!compose && assessment.kind === "unknown" && bundle.shade === "measurements-registry") {
    return [];
  }
  const findings: Finding[] = [dstackFinding(assessment), upgradeFinding(bundle, assessment, now)];
  if (!compose) return findings;
  findings.push(imageFinding(compose));
  findings.push(logsFinding(compose));
  findings.push(secretFinding(compose));
  return findings;
}

function dstackFinding(assessment: ReturnType<typeof assessDstack>): Finding {
  if (assessment.kind === "fixed") {
    return make(
      "dstack.range",
      "PROVEN",
      `Registered configuration is a fixed image (${assessment.label})`,
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

function secretFinding(compose: NonNullable<EvidenceBundle["compose"]>): Finding {
  const names = compose.envNames.filter(isSecretEnvName);
  if (names.length === 0) {
    return make(
      "dstack.secret_env",
      "PROVEN",
      "No secret-looking env names in the registered configuration",
      false,
      "Env names were checked for PRIVATE_KEY, SEED, API_KEY, SECRET, PASSWORD, TOKEN, and MNEMONIC. None matched. Values are not printed.",
    );
  }
  return make(
    "dstack.secret_env",
    "RISKY",
    "Registered configuration names secret-looking env vars",
    false,
    `These env names match a secret-looking pattern: ${names.join(", ")}. Glassbox reports the names only. A name in the registered configuration is not proof of the value, and the value is not shown.`,
    names.map((name) => ({ label: name })),
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
  return make("access.keys", assessed.ladder, title, false, assessed.reasons.join(" "), [
    { label: "view_access_key_list", detail: `${bundle.accessKeys?.length ?? 0} keys` },
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
    return make(
      "shade.interface",
      "NOT_PROVEN",
      "Contract interface was not recognised",
      false,
      bundle.shadeDetail,
      codeEvidence(bundle),
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

function judgeTcb(status: string, advisories: string[], when: string): { ladder: Ladder; text: string } {
  if (status === "UpToDate") {
    return {
      ladder: "PROVEN",
      text: `The registration quote verifies. TCB status ${when} is UpToDate.${advisories.length ? ` Advisory IDs: ${advisories.join(", ")}.` : ""}`,
    };
  }
  const extra = advisories.length ? ` Advisory IDs: ${advisories.join(", ")}.` : "";
  return {
    ladder: "RISKY",
    text: `The registration quote verifies, and the TCB status ${when} is ${status}.${extra}`,
  };
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
  const lines = ["@phala/dcap-qvl 0.7.1 (Apache-2.0) for TDX quote verification."];
  if (bundle.rpcEndpoints.length > 0) lines.push(`NEAR RPC: ${[...new Set(bundle.rpcEndpoints)].join(", ")}`);
  if (bundle.historySource === "nearblocks") lines.push("Transaction history: NearBlocks API.");
  if (bundle.historySource === "fastnear") lines.push("Transaction history: FastNEAR tx API.");
  if (bundle.historySource === "file") lines.push("Input: local JSON. Chain history was not queried.");
  lines.push("Shade measurement tables: shade-agent-cli (Apache-2.0), dstack 0.5.7 and 0.5.8 only.");
  lines.push(PHALA_POSTMORTEM_URL);
  return lines;
}

function attributionLines(bundle: EvidenceBundle): string[] {
  if (bundle.historySource !== "nearblocks") return [];
  return ["Powered by Nearblocks.io APIs."];
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

function sameHex(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  return left.toLowerCase().replace(/^0x/, "") === right.toLowerCase().replace(/^0x/, "");
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
): Finding {
  return { id, ladder, title, inference, plainEnglish, evidence };
}
