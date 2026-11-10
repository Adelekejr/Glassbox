/**
 * Hashes Glassbox will treat as a measurement.
 *
 * SHA-256 values in this repo are 64 hex characters: app code hashes, compose
 * hashes, os image hashes, and app-compose hash payloads.
 * SHA-384 values are 96 hex characters: MRTD, RTMR0–RTMR3, and the
 * key-provider event digest.
 * An optional 0x prefix is ignored. Case does not matter.
 * A NEAR contract code hash is base58 and is compared with a known template
 * elsewhere. It is not accepted here.
 */
const DIGEST = /^(?:0x)?([a-f0-9]{64}|[a-f0-9]{96})$/i;

export function normalizeDigest(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = DIGEST.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

export function isDigest(value: string | null | undefined): boolean {
  return normalizeDigest(value) !== null;
}

export function digestsEqual(left?: string | null, right?: string | null): boolean {
  const a = normalizeDigest(left);
  const b = normalizeDigest(right);
  if (!a || !b) return false;
  return a === b;
}

export function isNotInATee(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "not-in-a-tee";
}

/** Plain-English reason a value cannot prove a hash comparison. */
export function nonDigestSentence(
  value: string | null | undefined,
  what: string,
  proves = "which code runs",
): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return `The ${what} is empty, not a real hash, so it proves nothing about ${proves}.`;
  }
  if (isNotInATee(trimmed)) {
    return `The ${what} is the placeholder text "not-in-a-tee", not a real hash, so it proves nothing about ${proves}.`;
  }
  const shown = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  return `The ${what} is "${shown}", not a real hash, so it proves nothing about ${proves}.`;
}
