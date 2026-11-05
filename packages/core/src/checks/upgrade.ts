import { AUTO_UPGRADE_AT, PHALA_POSTMORTEM_URL } from "../types.js";
import type { DstackAssessment } from "./dstack.js";

export function upgradePlainEnglish(assessment: DstackAssessment, now: Date, shadeIsV2: boolean): string {
  const passed = now.getTime() >= AUTO_UPGRADE_AT;
  const schedule = passed
    ? "Phala's stated date has passed (20 Nov 2026). From that date, remaining v0.5.x and v0.6.0 CVMs were to be auto-upgraded in batches, and v0.3.x was to be retired with no upgrade path (enterprise excluded)."
    : "Phala's 19 Oct 2026 post-mortem says to move to v0.6.1 or v0.5.12 by 19 Nov 2026. From 20 Nov 2026, remaining v0.5.x and v0.6.0 CVMs are auto-upgraded in batches (24 hour notice on the status page), and v0.3.x is retired with no upgrade path (enterprise excluded).";
  const v2 =
    shadeIsV2
      ? " On Shade v2, an agent that comes back after an image change will not match approved_measurements until the owner approves the new measurements."
      : " Shade v1 approves an app codehash, so an OS image change does not by itself invalidate that codehash. A v0.3.x-era registration can still be retired by the operator.";
  if (assessment.kind === "fixed") {
    return `The registered configuration is on a fixed release (${assessment.label}). The 20 Nov 2026 auto-upgrade is for remaining v0.5.x and v0.6.0 images, not for 0.5.12 or 0.6.1. Source: ${PHALA_POSTMORTEM_URL}`;
  }
  if (assessment.kind === "vulnerable-heuristic") {
    return `${schedule}${v2} This registered configuration only matches a pre-0.5 pattern, so Glassbox cannot tell a v0.3.x retirement apart from another unfixed build.`;
  }
  if (assessment.kind === "declared-fixed") {
    return `${schedule} ${assessment.detail} The 20 Nov 2026 schedule is not cleared by a declared version alone.`;
  }
  if (assessment.kind === "unknown") {
    return `${schedule} Glassbox could not tell whether this registered configuration is one of the builds that schedule applies to. ${assessment.detail}`;
  }
  return `${schedule}${v2} ${assessment.detail}`;
}
