import type { EvidenceBundle, Finding, FindingProvenance, ObservationKind } from "./types.js";

const QUOTE_VERIFICATION = new Set([
  "tdx.signature",
  "tdx.qe_identity",
  "tdx.registration",
  "tdx.debug",
  "tdx.report_data",
  "tdx.advisories",
  "tdx.fresh",
  "measurements.quote_match",
]);

const SUPPLIED_REGISTRATION_CHECK = new Set(["rtmr.replay", "compose.hash"]);

const LOCAL_CHECK = new Set([
  "dstack.range",
  "dstack.upgrade",
  "measurements.provenance",
  "images.pin",
  "dstack.public_logs",
  "dstack.public_sysinfo",
  "dstack.secret_env",
  "compose.plaintext_secrets",
  "compose.sockets",
  "compose.kms",
  "compose.allowed_envs",
  "compose.debug_images",
  "contract.code",
]);

const ACCOUNT_STATE = new Set([
  "codehash.approved",
  "measurements.approved",
  "measurements.local_default",
  "agent.validity",
  "access.keys",
  "mpc.allowlist",
  "contract.approver",
  "contract.remove",
  "shade.interface",
]);

/**
 * True only for a PROVEN finding whose structured provenance is a fresh chain observation.
 * File equality, paste equality, and verification of supplied quote bytes return false.
 */
export function isLiveChainProof(finding: Finding): boolean {
  const provenance = finding.provenance;
  return (
    finding.ladder === "PROVEN" &&
    provenance.liveChain === true &&
    provenance.evidenceSource === "chain" &&
    provenance.observationKind === "chain"
  );
}

export function attachProvenance(finding: Finding, bundle: EvidenceBundle): Finding {
  return { ...finding, provenance: provenanceFor(finding, bundle) };
}

function provenanceFor(finding: Finding, bundle: EvidenceBundle): FindingProvenance {
  if (finding.id === "runtime.observed" || finding.id === "freshness.registration") {
    return row("unavailable", "unavailable", "Not a live chain observation.");
  }
  if (blockedByTransport(finding.id, bundle)) {
    return row(
      "unavailable",
      "unavailable",
      "This check did not complete. A transport failure is not MethodNotFound and is not a live chain observation.",
    );
  }

  const supplied = isSupplied(bundle);
  const origin = suppliedKind(bundle);

  if (QUOTE_VERIFICATION.has(finding.id)) {
    if (supplied) {
      return row(origin, "computed", "Verification of supplied quote bytes. Not a live chain observation.");
    }
    return row(
      "chain",
      "computed",
      "Verification of quote bytes loaded with the registration. Not a live guest observation.",
    );
  }
  if (SUPPLIED_REGISTRATION_CHECK.has(finding.id)) {
    if (supplied) {
      return row(origin, "computed", "Verification of supplied registration bytes. Not a live chain observation.");
    }
    return row("chain", "computed", "Local check of registration bytes loaded in this run. Not a live guest observation.");
  }
  if (LOCAL_CHECK.has(finding.id)) {
    if (supplied) {
      const label =
        finding.id === "contract.code"
          ? "Comparison of a supplied code hash with a published template. Not a live chain observation."
          : origin === "paste"
            ? "Local check of pasted JSON. Not a live chain observation."
            : "Local check of the supplied file. Not a live chain observation.";
      return row(origin, "computed", label);
    }
    return row("chain", "computed", "Local check of values read in this run. Not itself a fresh account-state observation.");
  }
  if (finding.id === "mpc.allowlist" && !supplied && !bundle.mpcFromSnapshot) {
    const lists = bundle.mpc ?? [];
    if (lists.length === 0 || lists.every((list) => list.error)) {
      return row("unavailable", "unavailable", "The MPC allowlist was not read. This is not a live chain observation.");
    }
  }
  if (finding.id === "shade.interface" && bundle.shade === "unknown" && hasUnavailableProbe(bundle)) {
    return row(
      "unavailable",
      "unavailable",
      "The interface was not classified. A transport failure is not MethodNotFound and is not a live chain observation.",
    );
  }
  if (finding.id === "agent.validity" && finding.ladder === "NOT_PROVEN") {
    return row(
      "unavailable",
      "unavailable",
      "Agent validity was not in the view. A missing or unrecognized field is not a fresh chain observation that the agent is invalid.",
    );
  }
  if (supplied || bundle.mpcFromSnapshot) {
    const source: ObservationKind = supplied ? origin : "file";
    const label =
      source === "paste"
        ? "Equality of values in pasted JSON. Not a live chain observation."
        : "Equality of values in the supplied file. Not a live chain observation.";
    return row(source, source, label);
  }
  if (ACCOUNT_STATE.has(finding.id)) {
    return row("chain", "chain", "Fresh chain observation from this run.");
  }
  return row("computed", "computed", "Local check. Not a live chain observation.");
}

function row(evidenceSource: ObservationKind, observationKind: ObservationKind, label: string): FindingProvenance {
  return {
    evidenceSource,
    observationKind,
    liveChain: evidenceSource === "chain" && observationKind === "chain",
    label,
  };
}

function isSupplied(bundle: EvidenceBundle): boolean {
  if (bundle.inputOrigin === "file" || bundle.inputOrigin === "paste") return true;
  if (bundle.inputOrigin === "chain") return false;
  return bundle.historySource === "file" || bundle.network === "offline";
}

function suppliedKind(bundle: EvidenceBundle): "file" | "paste" {
  return bundle.inputOrigin === "paste" ? "paste" : "file";
}

function hasUnavailableProbe(bundle: EvidenceBundle): boolean {
  return bundle.methodProbes?.some((probe) => probe.outcome === "unavailable") ?? false;
}

function blockedByTransport(id: string, bundle: EvidenceBundle): boolean {
  const unavailable = (name: string) =>
    bundle.methodProbes?.some((probe) => probe.name === name && probe.outcome === "unavailable") ?? false;
  if (id === "codehash.approved" && (unavailable("get_agent") || Boolean(bundle.agentViewError))) return true;
  if (id === "measurements.approved" && unavailable("get_approved_measurements")) return true;
  if (id === "access.keys" && bundle.accessKeyError) return true;
  return false;
}
