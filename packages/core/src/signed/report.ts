import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { planReportAnchor, type AnchorOutcome } from "./anchor.js";
import { loadOrCreateSigningKey, signUtf8, type SigningKey } from "./keys.js";
import type { Ladder, ObservationKind, Report } from "../types.js";

export interface CanonicalCheck {
  id: string;
  ladder: Ladder;
  title: string;
  inference: boolean;
  plainEnglish: string;
  evidenceSource: ObservationKind;
  observationKind: ObservationKind;
  /** False for file equality, paste equality, and verification of supplied quote bytes. */
  liveChain: boolean;
}

export interface CanonicalReportBody {
  tool: "glassbox";
  canonicalVersion: 1;
  generatedAt: string;
  inputs: {
    contract: string;
    agent: string | null;
    txHash: string | null;
    blockHeight: number | null;
    network: Report["network"];
    collateralSource: Report["inputs"]["collateralSource"];
    collateralFetchedAt: string | null;
    freshCollateralSource: string | null;
    tools: {
      glassbox: string;
      "@phala/dcap-qvl": string;
    };
  };
  checks: CanonicalCheck[];
  verdict: {
    overall: Ladder;
    proven: number;
    notProven: number;
    risky: number;
  };
}

export interface SignedReport {
  format: "glassbox-signed-report";
  version: 1;
  body: CanonicalReportBody;
  sha256: string;
  signature: {
    alg: "ed25519";
    publicKey: string;
    sig: string;
  };
  /** Outside the hashed body. Anchoring does not change the signature. */
  anchor: AnchorOutcome;
}

export function buildCanonicalBody(report: Report): CanonicalReportBody {
  const checks: CanonicalCheck[] = report.findings.map((finding) => ({
    id: finding.id,
    ladder: finding.ladder,
    title: finding.title,
    inference: finding.inference,
    plainEnglish: finding.plainEnglish,
    evidenceSource: finding.provenance.evidenceSource,
    observationKind: finding.provenance.observationKind,
    liveChain: finding.provenance.liveChain,
  }));
  checks.sort((a, b) => a.id.localeCompare(b.id));
  return {
    tool: "glassbox",
    canonicalVersion: 1,
    generatedAt: report.generatedAt,
    inputs: {
      contract: report.inputs.contract,
      agent: report.inputs.agent,
      txHash: report.inputs.txHash,
      blockHeight: report.inputs.blockHeight,
      network: report.network,
      collateralSource: report.inputs.collateralSource,
      collateralFetchedAt: report.inputs.collateralFetchedAt,
      freshCollateralSource: report.inputs.freshCollateralSource,
      tools: {
        glassbox: report.version,
        "@phala/dcap-qvl": report.verifier.version,
      },
    },
    checks,
    verdict: {
      overall: report.overall,
      proven: report.summary.proven,
      notProven: report.summary.notProven,
      risky: report.summary.risky,
    },
  };
}

export function signReport(report: Report, key?: SigningKey): { envelope: SignedReport; key: SigningKey } {
  const signingKey = key ?? loadOrCreateSigningKey();
  const body = buildCanonicalBody(report);
  const canonical = canonicalJson(body);
  const sha256 = canonicalSha256(body);
  const envelope: SignedReport = {
    format: "glassbox-signed-report",
    version: 1,
    body,
    sha256,
    signature: {
      alg: "ed25519",
      publicKey: signingKey.publicKeyHex,
      sig: signUtf8(signingKey.privateKey, canonical),
    },
    anchor: planReportAnchor({
      reportSha256: sha256,
      network: body.inputs.network,
      contract: body.inputs.contract,
      intent: report.anchor?.intent === true,
    }),
  };
  return { envelope, key: signingKey };
}

export function signedReportJson(envelope: SignedReport): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
