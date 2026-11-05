/** Same suffix rule as packages/core detectNetwork. Kept here so the browser does not import the audit library. */
export type NetworkName = "testnet" | "mainnet";

export function detectNetwork(accountId: string): NetworkName | null {
  const id = accountId.trim().toLowerCase();
  if (id.endsWith(".testnet")) return "testnet";
  if (id.endsWith(".near")) return "mainnet";
  return null;
}

/**
 * NEAR account id: 2–64 chars, lowercase, from the nomicon regex.
 * Implicit accounts (64 hex chars) match this too.
 */
const NEAR_ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const MAX_AUDIT_TARGET_CHARS = 2_000_000;

export function isNearAccountId(accountId: string): boolean {
  return accountId.length >= 2 && accountId.length <= 64 && NEAR_ACCOUNT_ID.test(accountId);
}

export type WebTarget =
  | { kind: "json" }
  | { kind: "account"; accountId: string }
  | { kind: "reject"; reason: string };

/**
 * The web API accepts a NEAR account id or JSON text.
 * It does not accept filesystem paths. `auditTarget` in core will read a path
 * that exists on disk, which is correct for the CLI and wrong for this route.
 */
export function classifyWebTarget(input: string): WebTarget {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "reject", reason: "target must be a NEAR account id or a JSON document." };
  }
  if (trimmed.length > MAX_AUDIT_TARGET_CHARS) {
    return { kind: "reject", reason: "target is too large." };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return { kind: "json" };
  if (isNearAccountId(trimmed)) return { kind: "account", accountId: trimmed };
  return {
    kind: "reject",
    reason: "target must be a NEAR account id or a JSON document. File paths are not accepted.",
  };
}

export function describeInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Paste a live account id, or JSON text. This page does not read a local file.";
  const classified = classifyWebTarget(trimmed);
  if (classified.kind === "json") {
    return "Pasted JSON on this page. The text in the box is compared. This is not a live account, and it is not a CLI local file.";
  }
  if (classified.kind === "reject") return classified.reason;
  const network = detectNetwork(classified.accountId);
  if (network) return `Live account on ${network}. This page reads it from NEAR.`;
  return "Live account. The suffix is not .testnet or .near, so Glassbox tries mainnet, then testnet.";
}
