import type { Network } from "../types.js";

export interface AnchorPlan {
  reportSha256: string;
  network: Network | "offline";
  contract: string;
}

export interface AnchorOutcome {
  status: "skipped";
  reason: string;
}

/**
 * Opt-in hook for a later build that may publish the report hash on NEAR.
 * This function does not create an account, does not load a signer, and does
 * not send a transaction. GLASSBOX_ANCHOR=1 records the intent only.
 */
export function planReportAnchor(plan: AnchorPlan): AnchorOutcome {
  if (!/^[0-9a-f]{64}$/.test(plan.reportSha256)) {
    return {
      status: "skipped",
      reason: "The report hash is not a sha256 hex string, so there is nothing to anchor.",
    };
  }
  if (process.env.GLASSBOX_ANCHOR === "1") {
    return {
      status: "skipped",
      reason:
        "GLASSBOX_ANCHOR=1 is set. This build records that intent and does not send a transaction. Publishing the report hash on NEAR stays a later opt-in. No account is required today.",
    };
  }
  return {
    status: "skipped",
    reason:
      "Report hash anchoring is off. Glassbox does not send a transaction. A later opt-in can publish this sha256 on NEAR. No account is required today.",
  };
}
