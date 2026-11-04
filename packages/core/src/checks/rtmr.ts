import { createHash } from "node:crypto";
import type { EventLogEntry, Measurements } from "../types.js";

/**
 * Replay one RTMR from a dstack/TDX event log.
 * Each event carries a 48-byte digest. The register starts at 48 zero bytes
 * and each matching `imr` extends it with SHA-384(current || digest), in log order.
 * Checked against the votron registration: replaying imr 0..3 reproduces rtmr0..3.
 */
export function replayRtmr(events: EventLogEntry[], imr: number): string {
  let current = Buffer.alloc(48, 0);
  for (const event of events) {
    if (Number(event.imr) !== imr) continue;
    const digest = Buffer.from(event.digest.replace(/^0x/, ""), "hex");
    if (digest.length !== 48) {
      throw new Error(`Event digest for imr ${imr} is ${digest.length} bytes, expected 48.`);
    }
    current = createHash("sha384").update(Buffer.concat([current, digest])).digest();
  }
  return current.toString("hex");
}

export function replayAll(events: EventLogEntry[]): Measurements {
  return {
    rtmr0: replayRtmr(events, 0),
    rtmr1: replayRtmr(events, 1),
    rtmr2: replayRtmr(events, 2),
    rtmr3: replayRtmr(events, 3),
  };
}

export function measurementsEqual(left: Measurements, right: Measurements, fields: (keyof Measurements)[]): boolean {
  return fields.every((field) => {
    const a = left[field];
    const b = right[field];
    if (!a || !b) return false;
    return a.toLowerCase().replace(/^0x/, "") === b.toLowerCase().replace(/^0x/, "");
  });
}
