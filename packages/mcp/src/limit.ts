/** One process, about the NearBlocks free-tier pace. Not a shared gateway limit. */
export const CHECK_WINDOW_MS = 60_000;
export const CHECK_MAX_PER_WINDOW = 6;

const timestamps: number[] = [];

export function resetCheckLimiter(): void {
  timestamps.length = 0;
}

/** Returns false when this process has already accepted the window's quota. */
export function takeCheckSlot(now = Date.now()): boolean {
  const cutoff = now - CHECK_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
  if (timestamps.length >= CHECK_MAX_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}
