/**
 * Hardware and OS measurements copied from the Shade Agent CLI.
 *
 * Licence: Apache-2.0. Copyright NearDeFi and contributors.
 * Source: shade-agent-cli/src/utils/measurements.js in
 * https://github.com/NearDeFi/shade-agent-framework
 * Tree read on 2026-11-04 at commit 35758f3.
 *
 * The upstream file ships tables only for dstack 0.5.7 and 0.5.8.
 * A match means "these RTMRs equal that published row". It does not mean
 * Glassbox measured the image itself. See NOTICE.
 */

export interface ShadeRtmrs {
  mrtd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
}

export const SHADE_MEASUREMENT_VERSIONS = ["0.5.7", "0.5.8"] as const;
export type ShadeTableVersion = (typeof SHADE_MEASUREMENT_VERSIONS)[number];

export const SHADE_INSTANCE_TYPES = [
  "tdx.small",
  "tdx.medium",
  "tdx.large",
  "tdx.xlarge",
  "tdx.2xlarge",
  "tdx.4xlarge",
  "tdx.8xlarge",
] as const;
export type ShadeInstanceType = (typeof SHADE_INSTANCE_TYPES)[number];

export const PHALA_KEY_PROVIDER_EVENT_DIGEST =
  "83368b43a0fc6f824f5a9220592df85fd30e2d405ecbd253a5c6354af63e6c9b41aec557c38a38e348ab87f9ac8fc68c";

type Table = Record<ShadeTableVersion, Record<ShadeInstanceType, { rtmrs: ShadeRtmrs }>>;

export const hardwareAndOSMeasurements: Table = {
  "0.5.8": {
    "tdx.small": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
    "tdx.medium": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "027b610ab0555482f8a3868524093bdf3cdbe2539f81dfeeb886864654cb2fe3422f7fc36d4bab6fa46683aad11d1ba7",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
    "tdx.large": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "fb14dc139f33d6fcf474bc8332cac001259fb31cfbcb6b34d4ceeb552a2c4466884a0cbde45ad98a05c5c060c23ad65a",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
    "tdx.xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "ec216f1d1d591468ff4741b9b192f016b26d3f90303bfa9dbb97557273853183981f21a4bcb3ae908247538d371ad072",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
    "tdx.2xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "d6118f0eeb30e9d9178d2b9106dddd002d979b6fa79bdec415051afae2021384c29a32d2f6454fa369617598378ffb5e",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
    "tdx.4xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "55b9b0d73279fd2079274371e639b70161a69447b6b07f7b5266f0b8a47fd1e527fca30338879b47ac18d9bf66022e5c",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
    "tdx.8xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "de03721065571be16e3ccbb76dacdc86a6dfb35255480dfc97932995c5d0973b6f0b6b7b9f8e88b838d72bc75e8a287c",
        rtmr1: "b598fde9491427341bc4683b75d10d3e36770af3a36a6954d8b6b7b22aa66358f13e1f172e51b7d6e6710d99a8d8532f",
        rtmr2: "9284cde236231d5ddace01104a440fd504df5182a2ad1ac3d2138b80c6a7864bd2c30f69041d8264217f3d24541580cf",
      },
    },
  },
  "0.5.7": {
    "tdx.small": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "68102e7b524af310f7b7d426ce75481e36c40f5d513a9009c046e9d37e31551f0134d954b496a3357fd61d03f07ffe96",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
    "tdx.medium": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "027b610ab0555482f8a3868524093bdf3cdbe2539f81dfeeb886864654cb2fe3422f7fc36d4bab6fa46683aad11d1ba7",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
    "tdx.large": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "fb14dc139f33d6fcf474bc8332cac001259fb31cfbcb6b34d4ceeb552a2c4466884a0cbde45ad98a05c5c060c23ad65a",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
    "tdx.xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "ec216f1d1d591468ff4741b9b192f016b26d3f90303bfa9dbb97557273853183981f21a4bcb3ae908247538d371ad072",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
    "tdx.2xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "d6118f0eeb30e9d9178d2b9106dddd002d979b6fa79bdec415051afae2021384c29a32d2f6454fa369617598378ffb5e",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
    "tdx.4xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "55b9b0d73279fd2079274371e639b70161a69447b6b07f7b5266f0b8a47fd1e527fca30338879b47ac18d9bf66022e5c",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
    "tdx.8xlarge": {
      rtmrs: {
        mrtd: "f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077",
        rtmr0: "de03721065571be16e3ccbb76dacdc86a6dfb35255480dfc97932995c5d0973b6f0b6b7b9f8e88b838d72bc75e8a287c",
        rtmr1: "920eb831509b58bf83a554b5377dd5ce26d3f5182f14d33622ac24c1d343a0fa3c7bde746e55098ca30baf784dfd2556",
        rtmr2: "4674857a0f5b090f9203245f55c6516c37f533b362576a505f5b89efa2a28376d6b82e984e41f1f0ebcddfcbeb9581b9",
      },
    },
  },
};

export interface ShadeTableMatch {
  version: ShadeTableVersion;
  instanceType: ShadeInstanceType | null;
  /** RTMR1 and RTMR2 matched. Instance type needs RTMR0 as well. */
  rtmr0Matched: boolean;
}

function norm(value: string | undefined | null): string {
  return (value ?? "").toLowerCase().replace(/^0x/, "");
}

/**
 * RTMR1 and RTMR2 identify the OS row. RTMR0 additionally names the instance
 * size. MRTD is shared by every row in these two tables, so it is checked
 * when present but a missing MRTD does not block an RTMR1/RTMR2 match.
 */
export function matchShadeMeasurements(input: {
  mrtd?: string | null;
  rtmr0?: string | null;
  rtmr1?: string | null;
  rtmr2?: string | null;
}): ShadeTableMatch | null {
  const rtmr1 = norm(input.rtmr1);
  const rtmr2 = norm(input.rtmr2);
  if (!rtmr1 || !rtmr2) return null;
  for (const version of SHADE_MEASUREMENT_VERSIONS) {
    const rows = hardwareAndOSMeasurements[version];
    let versionHit: ShadeInstanceType | null = null;
    for (const instanceType of SHADE_INSTANCE_TYPES) {
      const row = rows[instanceType].rtmrs;
      if (row.rtmr1 !== rtmr1 || row.rtmr2 !== rtmr2) continue;
      versionHit = instanceType;
      const mrtd = norm(input.mrtd);
      if (mrtd && mrtd !== row.mrtd) continue;
      const rtmr0 = norm(input.rtmr0);
      if (rtmr0 && rtmr0 === row.rtmr0) {
        return { version, instanceType, rtmr0Matched: true };
      }
    }
    if (versionHit) {
      return { version, instanceType: null, rtmr0Matched: false };
    }
  }
  return null;
}
