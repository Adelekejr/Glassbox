import { lookupFixedImage } from "../data/fixed-images.js";
import { matchShadeMeasurements } from "../data/shade-measurements.js";
import type { Ladder } from "../types.js";

export interface ProvenanceEvidence {
  label: string;
  detail: string;
}

export interface ProvenanceAssessment {
  ladder: Ladder;
  title: string;
  inference: boolean;
  detail: string;
  evidence: ProvenanceEvidence[];
}

export function assessProvenance(input: {
  osImageHash?: string | null;
  osImageHashConflict?: boolean;
  mrtd?: string | null;
  rtmr0?: string | null;
  rtmr1?: string | null;
  rtmr2?: string | null;
}): ProvenanceAssessment {
  const fixed = input.osImageHashConflict ? null : lookupFixedImage(input.osImageHash);
  const table = matchShadeMeasurements(input);
  const cleanTable = table?.mrtdMatched ? table : null;
  const evidence: ProvenanceEvidence[] = [];

  if (input.osImageHashConflict) {
    evidence.push({
      label: "os_image_hash",
      detail:
        "The os_image_hash field and the os-image-hash event payload differ. Neither value is treated as a known fixed image.",
    });
  } else if (!input.osImageHash) {
    evidence.push({
      label: "os_image_hash",
      detail:
        "Not present. The published fixed images are the dstack 0.5.12 family and dstack 0.6.1, and they are identified by this hash.",
    });
  } else if (fixed) {
    evidence.push({
      label: "os_image_hash",
      detail: `Matches the published fixed image ${fixed.name}.`,
    });
  } else {
    evidence.push({
      label: "os_image_hash",
      detail:
        "Present, and not a known fixed image. The fixed list is the 0.5.12 family and 0.6.1. The list can lag a newer release.",
    });
  }

  if (table && !table.mrtdMatched) {
    evidence.push({
      label: "rtmr1 and rtmr2",
      detail: `Equal Shade's published table for dstack ${table.version}. The MRTD does not match that row, so this is not a clean table match and it is not a known fixed image.`,
    });
    evidence.push({
      label: "mrtd",
      detail: "Present, and it does not match the MRTD on that Shade table row.",
    });
  } else if (cleanTable) {
    const instance = cleanTable.instanceType ? ` Instance ${cleanTable.instanceType}.` : " Instance size was not named.";
    evidence.push({
      label: "rtmr1 and rtmr2",
      detail: `Match Shade's published table for dstack ${cleanTable.version}, which is inside the vulnerable range 0.3.1–0.6.0. This is a comparison with that table, not a measurement Glassbox computed.${instance}`,
    });
    evidence.push({
      label: "rtmr0",
      detail: cleanTable.rtmr0Matched
        ? `Matches the ${cleanTable.instanceType} row in that table.`
        : input.rtmr0
          ? "Present, and it did not name an instance row in that table."
          : "Not present.",
    });
    evidence.push({
      label: "mrtd",
      detail: input.mrtd
        ? "Present, and it matches the MRTD on that Shade table row. MRTD is shared across instance sizes in the 0.5.7 and 0.5.8 tables."
        : "Not present. A missing MRTD does not block an RTMR1 and RTMR2 match.",
    });
  } else {
    for (const name of ["mrtd", "rtmr0", "rtmr1", "rtmr2"] as const) {
      const value = input[name];
      evidence.push({
        label: name,
        detail: value
          ? "Present, and not in the Shade 0.5.7 or 0.5.8 tables. Those tables are the vulnerable range this build can name. A miss is not a known fixed image."
          : "Not present, so it was not compared.",
      });
    }
  }

  if (input.osImageHashConflict) {
    if (cleanTable) {
      return {
        ladder: "RISKY",
        title: "Registered configuration matches a vulnerable configuration",
        inference: false,
        detail: `RTMR1 and RTMR2 match Shade's published table for dstack ${cleanTable.version}, inside 0.3.1–0.6.0. The os_image_hash field and the os-image-hash event payload differ, so neither value is treated as a known fixed image. The table is a comparison, not a measurement Glassbox computed.`,
        evidence,
      };
    }
    return {
      ladder: "NOT_PROVEN",
      title: "Registered os_image_hash and the os-image-hash event disagree",
      inference: false,
      detail:
        "The os_image_hash field and the os-image-hash event payload differ. Glassbox does not treat the registered configuration as a known fixed image.",
      evidence,
    };
  }
  if (fixed && table && !table.mrtdMatched) {
    return {
      ladder: "NOT_PROVEN",
      title: "Registered measurements disagree with a known fixed image",
      inference: false,
      detail: `os_image_hash matches the published fixed image ${fixed.name}, and RTMR1 and RTMR2 equal Shade's table for dstack ${table.version}, and the MRTD does not match that row. Glassbox does not treat the registered configuration as a known fixed image.`,
      evidence,
    };
  }
  if (fixed && cleanTable) {
    return {
      ladder: "RISKY",
      title: "Registered measurements disagree with a known fixed image",
      inference: false,
      detail: `os_image_hash matches the published fixed image ${fixed.name}, and RTMR1 and RTMR2 match Shade's table for dstack ${cleanTable.version} (a vulnerable range). Those comparisons disagree. Glassbox does not treat the registered configuration as a known fixed image. The Shade row is a comparison, not a measurement Glassbox computed.`,
      evidence,
    };
  }
  if (fixed) {
    return {
      ladder: "PROVEN",
      title: `Registered os_image_hash is a known fixed image (${fixed.name})`,
      inference: false,
      detail: `os_image_hash matches the published fixed image ${fixed.name}. MRTD and RTMR0–RTMR2 were not used as a substitute for that hash. Shade's tables cover 0.5.7 and 0.5.8 only, so a miss there does not change this match.`,
      evidence,
    };
  }
  if (table && !table.mrtdMatched) {
    return {
      ladder: "NOT_PROVEN",
      title: "OS image provenance is unknown",
      inference: false,
      detail: `RTMR1 and RTMR2 equal Shade's table for dstack ${table.version}, and the MRTD does not match that row. That is not a clean table match. It is not a known fixed image.`,
      evidence,
    };
  }
  if (cleanTable) {
    const hash = input.osImageHash ? " The registered os_image_hash is not a known fixed image." : "";
    return {
      ladder: "RISKY",
      title: "Registered configuration matches a vulnerable configuration",
      inference: false,
      detail: `RTMR1 and RTMR2 match Shade's published table for dstack ${cleanTable.version}, inside 0.3.1–0.6.0.${hash} The table is a comparison, not a measurement Glassbox computed.`,
      evidence,
    };
  }
  if (input.osImageHash) {
    return {
      ladder: "RISKY",
      title: "Registered os_image_hash is not a known fixed image",
      inference: true,
      detail:
        "The registered os_image_hash is not a known fixed image (dstack 0.5.12 family or 0.6.1). MRTD and RTMR0–RTMR2 are not in the Shade 0.5.7 or 0.5.8 tables. The fixed list can lag a newer release, so this is an inference that the image sits in dstack 0.3.1–0.6.0.",
      evidence,
    };
  }
  return {
    ladder: "NOT_PROVEN",
    title: "OS image provenance is unknown",
    inference: false,
    detail:
      "No os_image_hash was present, and MRTD and RTMR0–RTMR2 did not match Shade's 0.5.7 or 0.5.8 tables. The release is unknown. Unknown is not a known fixed image.",
    evidence,
  };
}
