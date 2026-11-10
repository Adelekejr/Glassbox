import type { Finding, Ladder, PlainSummary } from "./types.js";

/**
 * One or two short sentences, plus a "What to do" line, taken only from findings
 * that are already on the report. No model call. A missing check is not a pass.
 * The wording says a check came back proven only when every finding is PROVEN.
 */
const FULL_ACCESS =
  "The owner of this agent can still change its code at any time, so its secure-enclave promise does not fully hold.";
const NO_QUOTE = "This agent has not published proof that it runs inside a secure enclave.";
const WEAK_SETUP = "The software this agent registered matches a known weak setup.";
const NOT_FIXED = "The software this agent registered is not a known fixed release.";
const HISTORY_UNREAD =
  "The registration history could not be read, so this report cannot say whether a secure-enclave proof was published.";
const PROOF_FAILED = "The published enclave proof did not check out.";

export function buildPlainSummary(findings: Finding[]): PlainSummary {
  const sentences = pickSentences(findings);
  return { text: sentences.join(" "), whatToDo: whatToDo(findings) };
}

function pickSentences(findings: Finding[]): string[] {
  const chosen: string[] = [];
  const add = (sentence: string | null) => {
    if (!sentence || chosen.includes(sentence) || chosen.length >= 2) return;
    chosen.push(sentence);
  };

  const keys = byId(findings, "access.keys", "RISKY");
  if (keys) {
    add(/Full-access key/i.test(keys.plainEnglish) ? FULL_ACCESS : "A key on this account can still call it broadly, so the setup is not locked.");
  }
  if (byId(findings, "measurements.local_default", "RISKY")) {
    add("This agent registered a blank measurement, not a real secure-enclave measurement.");
  }
  if (byId(findings, "tdx.debug", "RISKY")) {
    add("This agent was registered in a test mode, which is not a real secure enclave.");
  }
  add(weakSoftware(byId(findings, "dstack.range", "RISKY")));
  add(weakSoftware(byId(findings, "measurements.provenance", "RISKY")));
  if (byId(findings, "compose.sockets", "RISKY")) {
    add("The registered setup gives the program a way into the machine that is supposed to protect it.");
  }
  if (byId(findings, "tdx.report_data", "RISKY")) {
    add("The registration proof does not name this agent.");
  }
  if (byId(findings, "measurements.quote_match", "RISKY") || byId(findings, "rtmr.replay", "RISKY") || byId(findings, "compose.hash", "RISKY")) {
    add("The registration proof does not match the measurements stored with it.");
  }
  const approved = byId(findings, "measurements.approved", "RISKY");
  if (approved) {
    add(
      /vulnerable configuration/i.test(approved.title)
        ? WEAK_SETUP
        : "The measurements stored for this agent are not on its approved list.",
    );
  }
  if (byId(findings, "tdx.registration", "RISKY") || byId(findings, "tdx.fresh", "RISKY")) {
    add("The secure-chip check on this registration is not fully current.");
  }
  if (byId(findings, "images.pin", "RISKY")) {
    add("The software this agent registered can be swapped later without a new registration.");
  }
  if (byId(findings, "compose.kms", "RISKY")) {
    add("The registered setup does not lock its settings.");
  }
  if (byId(findings, "dstack.public_logs", "RISKY") || byId(findings, "dstack.public_sysinfo", "RISKY")) {
    add("The registered setup makes its logs or system details public.");
  }
  if (byId(findings, "compose.plaintext_secrets", "RISKY")) {
    add("The registered setup contains secret values in plain text, and the values are not shown.");
  }
  if (byId(findings, "dstack.secret_env", "RISKY")) {
    add("The registered setup names secret-looking settings, and the values are not shown.");
  }
  if (byId(findings, "compose.debug_images", "RISKY")) {
    add("The registered setup uses a debug image.");
  }
  if (byId(findings, "compose.allowed_envs", "RISKY")) {
    add("The registered setup lets the host inject a wide set of settings.");
  }
  if (byId(findings, "dstack.upgrade", "RISKY")) {
    add("A scheduled software change may still apply to this agent.");
  }
  if (byId(findings, "tdx.advisories", "RISKY")) {
    add("The chip maker has listed known issues against this registration.");
  }
  if (byId(findings, "agent.validity", "RISKY")) {
    add("The contract says this agent is no longer valid.");
  }
  if (byId(findings, "contract.approver", "RISKY")) {
    add("More than one account has approved changes to this agent.");
  }
  if (byId(findings, "mpc.allowlist", "RISKY")) {
    add("An allowlist entry for this agent is past its end date.");
  }
  if (byId(findings, "tdx.qe_identity", "RISKY")) {
    add("The registration proof did not pass an identity check.");
  }
  if (chosen.length === 0 && findings.some((item) => item.ladder === "RISKY")) {
    add("This report found a risk. The findings below name it.");
  }

  add(registrationGap(byId(findings, "tdx.registration", "NOT_PROVEN")));
  const signature = byId(findings, "tdx.signature", "NOT_PROVEN");
  if (signature) {
    add(/did not verify/i.test(signature.title) ? PROOF_FAILED : NO_QUOTE);
  }
  if (byId(findings, "runtime.observed", "NOT_PROVEN")) {
    add("This report did not see what the agent is doing right now.");
  }

  if (chosen.length === 0) {
    if (findings.length === 0) return ["This report has no checks."];
    if (findings.every((item) => item.ladder === "PROVEN")) return ["Every check in this report came back proven."];
    return ["This report did not prove its checks."];
  }
  return chosen;
}

function weakSoftware(finding: Finding | undefined): string | null {
  if (!finding) return null;
  return /not a known fixed image/i.test(finding.title) ? NOT_FIXED : WEAK_SETUP;
}

function registrationGap(finding: Finding | undefined): string | null {
  if (!finding) return null;
  if (/No TDX quote is expected/i.test(finding.title)) return "This account does not publish a secure-enclave proof.";
  if (/failed history read|Could not read history/i.test(finding.plainEnglish)) return HISTORY_UNREAD;
  if (/was not accepted/i.test(finding.title)) return PROOF_FAILED;
  if (/was not checked/i.test(finding.title)) return "This report could not finish the secure-enclave check.";
  return NO_QUOTE;
}

function whatToDo(findings: Finding[]): string {
  if (findings.length === 0) return "Do not treat an empty report as proof.";
  if (findings.some((item) => item.ladder === "RISKY")) return "Do not treat this agent as locked down.";
  if (findings.some((item) => item.ladder !== "PROVEN")) return "Do not treat missing proof as a pass.";
  return "Read the findings if you want the detail.";
}

function byId(findings: Finding[], id: string, ladder: Ladder): Finding | undefined {
  return findings.find((item) => item.id === id && item.ladder === ladder);
}
