/** Best-effort in-process cap. One Node process, not a shared gateway limit. */
export const AUDIT_WINDOW_MS = 60_000;
export const AUDIT_MAX_PER_WINDOW = 10;

const timestamps: number[] = [];

export function resetAuditLimiter(): void {
  timestamps.length = 0;
}

/** Returns false when this process has already accepted the window's quota. */
export function takeAuditSlot(now = Date.now()): boolean {
  const cutoff = now - AUDIT_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
  if (timestamps.length >= AUDIT_MAX_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}
