import type { EventLogEntry, TcbInfo } from "../types.js";
import { sha256Hex } from "./compose.js";

export interface NormalizedRegistration {
  quoteHex?: string;
  collateral?: unknown;
  checksum?: string;
  tcbInfo?: TcbInfo;
  appComposeRaw?: string;
  appComposeSha256?: string;
}

export function normalizeRegistrationArgs(args: unknown): NormalizedRegistration | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const quoteHex = firstString(record.quote_hex, record.quoteHex, record.quote);
  const checksum = firstString(record.checksum);
  const collateral = record.collateral === undefined ? undefined : parseCollateral(record.collateral);
  const tcbRaw = record.tcb_info ?? record.tcbInfo ?? record.attestation;
  const tcbInfo = normalizeTcb(tcbRaw);
  const appComposeRaw = tcbInfo?.app_compose;
  const appComposeSha256 = typeof appComposeRaw === "string" ? sha256Hex(appComposeRaw) : undefined;
  if (!quoteHex && !tcbInfo && collateral === undefined) return null;
  return { quoteHex, collateral, checksum, tcbInfo, appComposeRaw, appComposeSha256 };
}

function parseCollateral(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function normalizeTcb(value: unknown): TcbInfo | undefined {
  let current = value;
  if (typeof current === "string") {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!current || typeof current !== "object") return undefined;
  const record = current as Record<string, unknown>;
  const appCompose = record.app_compose ?? record.appCompose;
  const eventLog = Array.isArray(record.event_log)
    ? record.event_log
    : Array.isArray(record.eventLog)
      ? record.eventLog
      : undefined;
  return {
    rootfs_hash: firstString(record.rootfs_hash),
    mrtd: firstString(record.mrtd),
    rtmr0: firstString(record.rtmr0),
    rtmr1: firstString(record.rtmr1),
    rtmr2: firstString(record.rtmr2),
    rtmr3: firstString(record.rtmr3),
    os_image_hash: firstString(record.os_image_hash, record.osImageHash),
    compose_hash: firstString(record.compose_hash, record.composeHash),
    device_id: firstString(record.device_id, record.deviceId),
    event_log: eventLog?.map(normalizeEvent).filter((entry): entry is EventLogEntry => entry !== null),
    app_compose: typeof appCompose === "string" ? appCompose : appCompose ? JSON.stringify(appCompose) : undefined,
  };
}

function normalizeEvent(value: unknown): EventLogEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const digest = firstString(record.digest);
  if (!digest) return null;
  return {
    imr: Number(record.imr),
    event_type: record.event_type === undefined ? undefined : Number(record.event_type),
    digest,
    event: firstString(record.event) ?? "",
    event_payload: firstString(record.event_payload, record.eventPayload) ?? "",
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function eventPayload(events: EventLogEntry[] | undefined, name: string): string | undefined {
  const found = events?.find((entry) => (entry.event ?? "").toLowerCase() === name.toLowerCase());
  const payload = found?.event_payload?.trim();
  return payload || undefined;
}

export function hasEvent(events: EventLogEntry[] | undefined, name: string): boolean {
  return Boolean(events?.some((entry) => (entry.event ?? "").toLowerCase() === name.toLowerCase()));
}

export interface OsImageHashSelection {
  /** Hash used for the fixed-image comparison. Absent when the two sources disagree or neither is present. */
  hash?: string;
  /** True when `os_image_hash` and the os-image-hash event payload both exist and are not the same hash. */
  conflict: boolean;
}

/**
 * The field and the event are different inputs. When both are present they
 * must be the same hash before either one can be a known fixed image.
 */
export function selectOsImageHash(tcb: TcbInfo | null | undefined): OsImageHashSelection {
  const field = tcb?.os_image_hash?.trim();
  const event = eventPayload(tcb?.event_log, "os-image-hash");
  if (field && event && !sameOsHex(field, event)) return { conflict: true };
  const hash = field || event;
  return hash ? { hash, conflict: false } : { conflict: false };
}

function sameOsHex(left: string, right: string): boolean {
  return left.toLowerCase().replace(/^0x/, "") === right.toLowerCase().replace(/^0x/, "");
}
