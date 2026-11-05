/**
 * Client-side audit request state.
 * A new read keeps the previous report until a new one arrives.
 * The wait is a single bound, not a staged progress timer.
 */
export const AUDIT_CLIENT_TIMEOUT_MS = 180_000;

export interface HeldReport<T> {
  report: T | null;
  source: "audit" | "sample" | null;
  pending: boolean;
  notice: string | null;
  noticeKind: "error" | "sample" | null;
}

export function emptyHeldReport<T>(): HeldReport<T> {
  return { report: null, source: null, pending: false, notice: null, noticeKind: null };
}

export function beginAudit<T>(state: HeldReport<T>): HeldReport<T> {
  return {
    report: state.report,
    source: state.source,
    pending: true,
    notice: state.source === "sample" ? state.notice : null,
    noticeKind: state.source === "sample" ? "sample" : null,
  };
}

export function succeedAudit<T>(state: HeldReport<T>, report: T): HeldReport<T> {
  return { report, source: "audit", pending: false, notice: null, noticeKind: null };
}

export function failAudit<T>(state: HeldReport<T>, notice: string): HeldReport<T> {
  const keepSample = state.source === "sample" && state.noticeKind === "sample" && state.notice;
  return {
    report: state.report,
    source: state.source,
    pending: false,
    notice: keepSample ? state.notice : notice,
    noticeKind: keepSample ? "sample" : "error",
  };
}

export function stopWaiting<T>(state: HeldReport<T>): HeldReport<T> {
  return { ...state, pending: false };
}

export function showSavedSample<T>(state: HeldReport<T>, report: T, notice: string): HeldReport<T> {
  return { report, source: "sample", pending: false, notice, noticeKind: "sample" };
}

export function auditFailureNotice(reason: string, keptReport: boolean): string {
  const retry = "Select Audit to try again.";
  if (keptReport) return `${reason} The report below is unchanged. ${retry}`;
  return `${reason} ${retry}`;
}

export function auditTimeoutNotice(keptReport: boolean): string {
  return auditFailureNotice(
    "Stopped waiting after 3 minutes. A live account often takes about half a minute, and longer when NearBlocks spaces its calls.",
    keptReport,
  );
}

export function auditHttpNotice(status: number, error: string | undefined, keptReport: boolean): string {
  const reason = error?.trim() || `Request failed (${status}).`;
  return auditFailureNotice(reason, keptReport);
}

export function auditNetworkNotice(cause: unknown, keptReport: boolean): string {
  const detail = cause instanceof Error && cause.message ? cause.message : "The audit request failed.";
  return auditFailureNotice(detail, keptReport);
}
