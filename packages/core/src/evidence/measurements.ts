import type { ApprovalEvent, ApprovedMeasurementRow, ShadeKind, ShadeV2Agent } from "../types.js";
import { isoFromUnixMs, nsToSeconds } from "../types.js";
import type { HistoryCall } from "../near/history.js";
import { isDigest, digestsEqual } from "./digest.js";

export function approvalMethodsFor(shade: ShadeKind): string[] {
  switch (shade) {
    case "shade-v1":
    case "shade-v1-worker":
      return ["approve_codehash", "remove_codehash"];
    case "shade-v2":
      return ["approve_measurements", "remove_measurements", "approve_ppids", "remove_ppids"];
    case "measurements-registry":
      return ["approve_measurements", "remove_measurements"];
    case "mpc-signer":
      return [];
    default:
      return ["approve_codehash", "approve_measurements"];
  }
}

export function normalizeMeasurementRow(value: unknown): ApprovedMeasurementRow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nested = record.rtmrs && typeof record.rtmrs === "object" ? (record.rtmrs as Record<string, unknown>) : record;
  const row: ApprovedMeasurementRow = {
    mrtd: asString(nested.mrtd),
    rtmr0: asString(nested.rtmr0),
    rtmr1: asString(nested.rtmr1),
    rtmr2: asString(nested.rtmr2),
    rtmr3: asString(nested.rtmr3 ?? record.rtmr3),
    app_compose_hash_payload: asString(record.app_compose_hash_payload),
    key_provider_event_digest: asString(record.key_provider_event_digest),
    ppid: asString(record.ppid),
  };
  if (!row.mrtd && !row.rtmr0 && !row.rtmr1 && !row.rtmr2) return null;
  return row;
}

export function normalizeV2Agent(value: unknown): ShadeV2Agent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const accountId = asString(record.account_id);
  const measurements = normalizeMeasurementRow(record.measurements);
  if (!accountId || !measurements) return null;
  const validity = describeValidity(record.validity);
  const until = asMillis(record.valid_until_ms);
  return {
    accountId,
    measurements: { ...measurements, ppid: measurements.ppid ?? asString(record.ppid) },
    ppid: asString(record.ppid),
    validUntilMs: until,
    validity: validity.text,
    valid: validity.valid,
  };
}

export function isZeroMeasurement(row: ApprovedMeasurementRow): boolean {
  return [row.mrtd, row.rtmr0, row.rtmr1, row.rtmr2].every((value) => typeof value === "string" && /^0+$/.test(value.replace(/^0x/, "")));
}

export type MeasurementComparison = "match" | "mismatch" | "incomplete" | "not-digest";

const STATIC_FIELDS = ["mrtd", "rtmr0", "rtmr1", "rtmr2"] as const;
const CLAIMED_FIELDS = ["key_provider_event_digest", "app_compose_hash_payload"] as const;

/**
 * A field counts as a match only when both sides carry a real digest and the values agree.
 * A missing key-provider digest or app-compose hash is incomplete, not a match.
 * A present value that is not a digest (for example "not-in-a-tee") is not a match.
 * When requireClaimedFields is false, those two are compared only if both sides have them
 * (the non-v2 sentence does not claim them).
 */
export function compareMeasurements(
  approved: ApprovedMeasurementRow,
  registered: ApprovedMeasurementRow,
  requireClaimedFields: boolean,
): MeasurementComparison {
  let incomplete = false;
  let notDigest = false;
  const fields = requireClaimedFields ? [...STATIC_FIELDS, ...CLAIMED_FIELDS] : [...STATIC_FIELDS];
  for (const field of fields) {
    const result = compareField(approved[field], registered[field]);
    if (result === "mismatch") return "mismatch";
    if (result === "incomplete") incomplete = true;
    if (result === "not-digest") notDigest = true;
  }
  if (!requireClaimedFields) {
    for (const field of CLAIMED_FIELDS) {
      const left = approved[field];
      const right = registered[field];
      if (!left || !right) continue;
      const result = compareField(left, right);
      if (result === "mismatch") return "mismatch";
      if (result === "not-digest") notDigest = true;
    }
  }
  if (notDigest) return "not-digest";
  return incomplete ? "incomplete" : "match";
}

const NAMED_DIGEST_FIELDS: { field: keyof ApprovedMeasurementRow; what: string }[] = [
  { field: "key_provider_event_digest", what: "key-provider digest" },
  { field: "app_compose_hash_payload", what: "app-compose hash" },
  { field: "mrtd", what: "measurement" },
  { field: "rtmr0", what: "measurement" },
  { field: "rtmr1", what: "measurement" },
  { field: "rtmr2", what: "measurement" },
  { field: "rtmr3", what: "measurement" },
];

/** First present value in these rows that is not a 64- or 96-character hex digest. */
export function firstNonDigestField(rows: ApprovedMeasurementRow[]): { what: string; value: string } | null {
  for (const row of rows) {
    for (const { field, what } of NAMED_DIGEST_FIELDS) {
      const value = row[field];
      if (typeof value === "string" && value.trim() && !isDigest(value)) return { what, value };
    }
  }
  return null;
}

function compareField(left?: string, right?: string): MeasurementComparison {
  if (!left || !right) return "incomplete";
  if (!isDigest(left) || !isDigest(right)) return "not-digest";
  return digestsEqual(left, right) ? "match" : "mismatch";
}

export function approvalEventsFromCalls(method: string, calls: HistoryCall[]): ApprovalEvent[] {
  return calls.map((call) => {
    const seconds = nsToSeconds(call.timestampNs);
    return {
      method,
      kind: method.startsWith("remove") ? "remove" : "approve",
      txHash: call.hash,
      signer: call.signer,
      timestampNs: call.timestampNs,
      timestampIso: seconds !== undefined ? isoFromUnixMs(seconds * 1000) : undefined,
      success: call.success,
      detail: summarizeApprovalArgs(call.args),
    };
  });
}

function summarizeApprovalArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "no parsed arguments";
  const record = args as Record<string, unknown>;
  if (typeof record.codehash === "string") return `codehash ${record.codehash}`;
  if (record.measurements) {
    const row = normalizeMeasurementRow(record.measurements);
    if (!row) return "measurements";
    return `mrtd ${short(row.mrtd)} rtmr0 ${short(row.rtmr0)}`;
  }
  if (Array.isArray(record.ppids)) return `${record.ppids.length} ppid${record.ppids.length === 1 ? "" : "s"}`;
  return "arguments present";
}

function describeValidity(value: unknown): { valid: boolean | null; text: string } {
  if (value === "Valid") return { valid: true, text: "Valid" };
  if (value === "Invalid") return { valid: false, text: "Invalid" };
  if (value && typeof value === "object" && "Invalid" in value) {
    const reasons = (value as { Invalid: unknown }).Invalid;
    const text = Array.isArray(reasons) ? reasons.map(String).filter(Boolean).join(", ") : "";
    return { valid: false, text: text ? `Invalid (${text})` : "Invalid" };
  }
  return { valid: null, text: "" };
}

function asMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function short(value?: string): string {
  if (!value) return "(missing)";
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}
