import { sha256Hex } from "../evidence/compose.js";

/** Stable JSON: object keys sorted, no extra whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child === undefined) continue;
    out[key] = canonicalize(child);
  }
  return out;
}
