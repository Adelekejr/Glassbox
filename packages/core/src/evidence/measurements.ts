import type { ApprovalEvent, ApprovedMeasurementRow, ShadeKind, ShadeV2Agent } from "../types.js";
import { nsToSeconds } from "../types.js";
import type { HistoryCall } from "../near/history.js";

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

export function measurementsMatch(approved: ApprovedMeasurementRow, registered: ApprovedMeasurementRow): boolean {
  const staticFields = ["mrtd", "rtmr0", "rtmr1", "rtmr2"] as const;
  if (!staticFields.every((field) => same(approved[field], registered[field]))) return false;
  if (registered.key_provider_event_digest && approved.key_provider_event_digest) {
    if (!same(approved.key_provider_event_digest, registered.key_provider_event_digest)) return false;
  }
  if (registered.app_compose_hash_payload && approved.app_compose_hash_payload) {
    if (!same(approved.app_compose_hash_payload, registered.app_compose_hash_payload)) return false;
  }
  return true;
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
      timestampIso: seconds ? new Date(seconds * 1000).toISOString() : undefined,
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

function describeValidity(value: unknown): { valid: boolean; text: string } {
  if (value === "Valid") return { valid: true, text: "Valid" };
  if (value && typeof value === "object" && "Invalid" in value) {
    const reasons = (value as { Invalid: unknown }).Invalid;
    const text = Array.isArray(reasons) ? reasons.map(String).join(", ") : JSON.stringify(reasons);
    return { valid: false, text: `Invalid (${text})` };
  }
  if (typeof value === "string") return { valid: false, text: value };
  return { valid: false, text: "validity was not in the view" };
}

function asMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function same(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.toLowerCase().replace(/^0x/, "") === right.toLowerCase().replace(/^0x/, "");
}

function short(value?: string): string {
  if (!value) return "(missing)";
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}
