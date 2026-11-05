import { lookupFixedImage } from "../data/fixed-images.js";
import { matchShadeMeasurements } from "../data/shade-measurements.js";
import type { ComposeFacts, Measurements } from "../types.js";

export type DstackKind =
  | "fixed"
  | "declared-fixed"
  | "vulnerable-table"
  | "vulnerable-declared"
  | "vulnerable-heuristic"
  | "not-fixed-image"
  | "unknown";

export interface DstackAssessment {
  kind: DstackKind;
  inference: boolean;
  label: string;
  detail: string;
}

/**
 * Numeric range 0.3.1 through 0.6.0, with the published fixes 0.5.12 and 0.6.1
 * taken back out. Versions outside the range are "not in the stated range",
 * which is not the same thing as "fixed".
 */
export function versionInVulnerableRange(version: string): boolean | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (isNamedFixRelease(version)) return false;
  const value = major * 1_000_000 + minor * 1_000 + patch;
  const low = 3 * 1_000 + 1;
  const high = 6 * 1_000;
  if (value >= low && value <= high) return true;
  return false;
}

/** The two releases Phala named as fixes. A declared string is not itself an os_image_hash. */
export function isNamedFixRelease(version: string): boolean {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return (major === 0 && minor === 5 && patch === 12) || (major === 0 && minor === 6 && patch === 1);
}

export function assessDstack(input: {
  measurements?: Measurements | null;
  osImageHash?: string | null;
  compose?: ComposeFacts | null;
  hasOsImageHashEvent: boolean;
  hasRootfsHashEvent: boolean;
}): DstackAssessment {
  const declaredNote = declaredVersionNote(input.compose);
  // A hash, when present, is the comparison. A declared dstack_version cannot prove a fixed image beside it.
  // A Shade table hit is not hidden by an os_image_hash, and the two are not merged into a fixed image when they disagree.
  const fixed = lookupFixedImage(input.osImageHash);
  const table = matchShadeMeasurements(input.measurements ?? {});
  if (fixed && table) {
    const instance = table.instanceType ? `, instance ${table.instanceType}` : "";
    return {
      kind: "vulnerable-table",
      inference: false,
      label: `${fixed.name} vs ${table.version}`,
      detail: `os_image_hash matches the published fixed image ${fixed.name}, and RTMR1 and RTMR2 match Shade's published Apache-2.0 measurement table for dstack ${table.version}${instance}. That table is inside 0.3.1–0.6.0. The two comparisons disagree. Glassbox does not treat the registered configuration as a known fixed image. The table is a comparison, not a measurement Glassbox computed.${declaredNote}`,
    };
  }
  if (fixed) {
    return {
      kind: "fixed",
      inference: false,
      label: fixed.name,
      detail: `os_image_hash matches the published fixed image ${fixed.name}.${declaredNote}`,
    };
  }
  if (table) {
    const instance = table.instanceType ? `, instance ${table.instanceType}` : "";
    const hashNote = input.osImageHash ? " The registered os_image_hash is not a known fixed image." : "";
    return {
      kind: "vulnerable-table",
      inference: false,
      label: table.version,
      detail: `RTMR1 and RTMR2 match Shade's published Apache-2.0 measurement table for dstack ${table.version}${instance}. That release is inside 0.3.1–0.6.0. The table is a comparison, not a measurement Glassbox computed.${hashNote}${declaredNote}`,
    };
  }
  if (input.osImageHash) {
    return {
      kind: "not-fixed-image",
      inference: true,
      label: input.osImageHash.slice(0, 16),
      detail: `The registered os_image_hash is not a known fixed image (dstack 0.5.12 or 0.6.1, including the published 0.5.12 dev and nvidia variants). MRTD and RTMR0–RTMR2 are not in the Shade 0.5.7 or 0.5.8 tables. Glassbox's fixed list can lag a newer release, so this is an inference that the image sits in dstack 0.3.1–0.6.0.${declaredNote}`,
    };
  }
  const declared = input.compose?.dstackVersion;
  if (declared && input.compose?.versionDeclared) {
    const inRange = versionInVulnerableRange(declared);
    if (inRange === true) {
      return {
        kind: "vulnerable-declared",
        inference: false,
        label: declared,
        detail: `The configuration declares dstack_version ${declared}, which is inside 0.3.1–0.6.0 and is not the 0.5.12 or 0.6.1 fix.`,
      };
    }
    if (inRange === false && isNamedFixRelease(declared)) {
      return {
        kind: "declared-fixed",
        inference: true,
        label: declared,
        detail: `The configuration declares dstack_version ${declared}. No os_image_hash was present to compare with the published fixed images, so this is not a proven fixed image.`,
      };
    }
  }
  if (!input.hasOsImageHashEvent && input.compose?.referencesTappdSocket) {
    const rootfs = input.hasRootfsHashEvent ? " The event log has a rootfs-hash event and no os-image-hash event." : "";
    return {
      kind: "vulnerable-heuristic",
      inference: true,
      label: "pre-0.5 pattern",
      detail: `Heuristic. The registered configuration references /var/run/tappd.sock and has no os-image-hash event.${rootfs} That pattern fits dstack before 0.5 (often described as 0.3.x or 0.4.x). It matches a vulnerable configuration in the 0.3.1–0.6.0 range. It does not identify an exact release.`,
    };
  }
  return {
    kind: "unknown",
    inference: false,
    label: "unknown",
    detail:
      "No os_image_hash, Shade 0.5.7/0.5.8 table match, declared dstack_version, or pre-0.5 socket pattern was available. The dstack release is not proven.",
  };
}

function declaredVersionNote(compose: ComposeFacts | null | undefined): string {
  if (!compose?.versionDeclared || !compose.dstackVersion) return "";
  return ` The configuration also declares dstack_version ${compose.dstackVersion}. That string was not used in place of the os_image_hash comparison.`;
}
