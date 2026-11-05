import type { Network, ReportAnchor } from "../types.js";

export interface AnchorPlan {
  reportSha256: string;
  network: Network | "offline";
  contract: string;
  /** Set by --anchor. GLASSBOX_ANCHOR=1 is the same request. Neither one sends a transaction. */
  intent?: boolean;
}

export type AnchorOutcome = ReportAnchor;

export const ANCHOR_INSTRUCTIONS = [
  "How a later opt-in would anchor a report hash on NEAR:",
  "1. Glassbox hashes the canonical report body with sha256. --sign already does this.",
  "2. An operator would submit that 32-byte hash in a function call on a contract they choose, and they would pay the gas.",
  "3. This build does not build that transaction, does not load a NEAR signer, and does not spend gas.",
  "4. GLASSBOX_ANCHOR=1 and --anchor only record the intent. The status stays skipped.",
].join("\n");

/**
 * Opt-in hook for a later build that may publish the report hash on NEAR.
 * This function does not create an account, does not load a signer, and does
 * not send a transaction. GLASSBOX_ANCHOR=1 and --anchor record the intent only.
 */
export function planReportAnchor(plan: AnchorPlan): AnchorOutcome {
  const fromFlag = plan.intent === true;
  const fromEnv = process.env.GLASSBOX_ANCHOR === "1";
  const intent = fromFlag || fromEnv;
  if (!/^[0-9a-f]{64}$/.test(plan.reportSha256)) {
    return {
      status: "skipped",
      intent,
      reason: "The report hash is not a sha256 hex string, so there is nothing to anchor. Glassbox does not send a transaction.",
    };
  }
  if (intent) {
    const how =
      fromFlag && fromEnv
        ? "--anchor and GLASSBOX_ANCHOR=1 are set."
        : fromFlag
          ? "--anchor is set."
          : "GLASSBOX_ANCHOR=1 is set.";
    return {
      status: "skipped",
      intent: true,
      reason: `${how} This build records that intent and does not send a transaction. Report sha256: ${plan.reportSha256}. Publishing the report hash on NEAR stays a later opt-in. No NEAR key is loaded, and no account is required today.`,
    };
  }
  return {
    status: "skipped",
    intent: false,
    reason: `Report hash anchoring is off. Glassbox does not send a transaction. Report sha256: ${plan.reportSha256}. A later opt-in can publish this sha256 on NEAR. No NEAR key is loaded, and no account is required today.`,
  };
}
