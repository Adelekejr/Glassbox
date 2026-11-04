import type { MpcAllowlist, MpcHashEntry } from "../types.js";

/** Public views named in the day-1 scope. v1.signer is a top-level mainnet account. */
export const MPC_TARGETS = [
  { accountId: "v1.signer", network: "mainnet" as const },
  { accountId: "v1.signer-prod.testnet", network: "testnet" as const },
];

export function entryExpiry(entry: MpcHashEntry, nowSec: number): "none" | "active" | "expired" {
  if (entry.expiry_timestamp_seconds === null || entry.expiry_timestamp_seconds === undefined) return "none";
  return entry.expiry_timestamp_seconds < nowSec ? "expired" : "active";
}

export function formatExpiry(entry: MpcHashEntry): string {
  if (entry.expiry_timestamp_seconds === null || entry.expiry_timestamp_seconds === undefined) {
    return "no expiry";
  }
  return new Date(entry.expiry_timestamp_seconds * 1000).toISOString();
}

export function matchingDigests(digests: string[], lists: MpcAllowlist[]): { digest: string; list: MpcAllowlist; entry: MpcHashEntry }[] {
  const want = new Set(digests.map((digest) => digest.toLowerCase()));
  const hits: { digest: string; list: MpcAllowlist; entry: MpcHashEntry }[] = [];
  for (const list of lists) {
    for (const entry of list.entries) {
      const hash = entry.image_hash.toLowerCase();
      if (want.has(hash)) hits.push({ digest: hash, list, entry });
    }
  }
  return hits;
}
