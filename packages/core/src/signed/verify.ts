import { parseCompose, sha256Hex } from "../evidence/compose.js";
import { normalizeRegistrationArgs } from "../evidence/registration.js";
import { extractFunctionCallArgs } from "../near/history.js";
import { NearClient } from "../near/rpc.js";
import { buildReport } from "../report.js";
import { detectNetwork, type EvidenceBundle, type Ladder, type Network, type Report } from "../types.js";
import { canonicalJson } from "./canonical.js";
import { verifyEd25519 } from "./keys.js";
import type { CanonicalReportBody, SignedReport } from "./report.js";

/**
 * Checks that a registration transaction can replay.
 * Fresh collateral, access keys, and allowlists are time-varying, so they stay
 * inside the signature and are not re-fetched.
 */
export const REGISTRATION_CHECK_IDS = [
  "runtime.observed",
  "tdx.signature",
  "tdx.qe_identity",
  "tdx.registration",
  "tdx.debug",
  "tdx.report_data",
  "measurements.quote_match",
  "rtmr.replay",
  "compose.hash",
  "dstack.range",
  "dstack.upgrade",
  "images.pin",
  "dstack.public_logs",
  "dstack.public_sysinfo",
  "dstack.secret_env",
  "compose.plaintext_secrets",
  "compose.sockets",
  "compose.kms",
  "compose.allowed_envs",
  "compose.debug_images",
] as const;

export interface VerifyOptions {
  /** Skip the archival re-fetch. Hash and signature are still checked. */
  offline?: boolean;
  fetch?: typeof fetch;
  rpcEndpoints?: string[];
}

export interface LadderMismatch {
  id: string;
  signed: Ladder | "missing";
  recomputed: Ladder | "missing";
}

export interface VerifyResult {
  ok: boolean;
  hashOk: boolean;
  signatureOk: boolean;
  refetched: boolean;
  network: Network | null;
  blockHeightOk: boolean | null;
  mismatches: LadderMismatch[];
  compared: number;
  notes: string[];
}

export function networkForVerify(contract: string, recorded: Report["network"]): Network | null {
  const detected = detectNetwork(contract);
  if (detected && (recorded === "testnet" || recorded === "mainnet") && recorded !== detected) {
    throw new Error(`The report says ${recorded}, and the account suffix selects ${detected}.`);
  }
  if (detected) return detected;
  if (recorded === "testnet" || recorded === "mainnet") return recorded;
  return null;
}

export function parseSignedReport(value: unknown): SignedReport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SignedReport>;
  if (record.format !== "glassbox-signed-report" || record.version !== 1) return null;
  if (!record.body || typeof record.body !== "object") return null;
  if (typeof record.sha256 !== "string" || !record.signature || typeof record.signature !== "object") return null;
  return record as SignedReport;
}

export async function verifySignedReport(value: unknown, options: VerifyOptions = {}): Promise<VerifyResult> {
  const notes: string[] = [];
  const parsed = parseSignedReport(value);
  if (!parsed) {
    return {
      ok: false,
      hashOk: false,
      signatureOk: false,
      refetched: false,
      network: null,
      blockHeightOk: null,
      mismatches: [],
      compared: 0,
      notes: ["This file is not a Glassbox signed report."],
    };
  }
  const canonical = canonicalJson(parsed.body);
  const hashOk = sha256Hex(canonical) === parsed.sha256.toLowerCase();
  const signatureOk =
    parsed.signature.alg === "ed25519" &&
    verifyEd25519(parsed.signature.publicKey, canonical, parsed.signature.sig);
  if (!hashOk) notes.push("The sha256 does not match the canonical report body.");
  if (!signatureOk) notes.push("The ed25519 signature does not match the canonical report body.");

  let network: Network | null = null;
  try {
    network = networkForVerify(parsed.body.inputs.contract, parsed.body.inputs.network);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(message);
    return failed(hashOk, signatureOk, notes);
  }

  const canRefetch = Boolean(network && parsed.body.inputs.txHash && parsed.body.inputs.agent);
  if (options.offline) {
    notes.push("Registration evidence was not re-fetched (--offline). Hash and signature were checked.");
    return {
      ok: hashOk && signatureOk,
      hashOk,
      signatureOk,
      refetched: false,
      network,
      blockHeightOk: null,
      mismatches: [],
      compared: 0,
      notes,
    };
  }
  if (!canRefetch || !network) {
    notes.push(
      "No registration transaction was recorded for a chain network, so checks were not recomputed from archival RPC.",
    );
    return {
      ok: hashOk && signatureOk,
      hashOk,
      signatureOk,
      refetched: false,
      network,
      blockHeightOk: null,
      mismatches: [],
      compared: 0,
      notes,
    };
  }

  try {
    const fetched = await fetchRegistration(parsed.body, network, options);
    const blockHeightOk = compareBlockHeight(parsed.body.inputs.blockHeight, fetched.blockHeight);
    if (blockHeightOk === false) {
      notes.push(
        `Block height ${String(fetched.blockHeight)} does not match the signed report (${String(parsed.body.inputs.blockHeight)}).`,
      );
    }
    const recomputed = recomputeReport(parsed.body, fetched.args, fetched.blockHeight);
    const { mismatches, compared } = compareRegistrationChecks(parsed.body, recomputed);
    if (mismatches.length > 0) {
      notes.push(
        `Recomputed checks differ: ${mismatches.map((item) => `${item.id} ${item.signed} → ${item.recomputed}`).join("; ")}.`,
      );
    } else {
      notes.push(
        `Registration evidence was re-fetched from ${network} archival RPC. ${compared} checks matched. Fresh collateral, access keys, and allowlists were left as signed.`,
      );
    }
    return {
      ok: hashOk && signatureOk && blockHeightOk !== false && mismatches.length === 0,
      hashOk,
      signatureOk,
      refetched: true,
      network,
      blockHeightOk,
      mismatches,
      compared,
      notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Registration evidence could not be re-fetched. ${message}`);
    return {
      ok: false,
      hashOk,
      signatureOk,
      refetched: false,
      network,
      blockHeightOk: null,
      mismatches: [],
      compared: 0,
      notes,
    };
  }
}

function failed(hashOk: boolean, signatureOk: boolean, notes: string[]): VerifyResult {
  return {
    ok: false,
    hashOk,
    signatureOk,
    refetched: false,
    network: null,
    blockHeightOk: null,
    mismatches: [],
    compared: 0,
    notes,
  };
}

async function fetchRegistration(
  body: CanonicalReportBody,
  network: Network,
  options: VerifyOptions,
): Promise<{ args: unknown; blockHeight?: number }> {
  const client = new NearClient({
    network,
    archival: true,
    fetch: options.fetch,
    endpoints: options.rpcEndpoints,
    minIntervalMs: options.fetch ? 0 : undefined,
    sleep: options.fetch ? async () => undefined : undefined,
  });
  const txHash = body.inputs.txHash as string;
  const agent = body.inputs.agent as string;
  const tx = await client.transaction(txHash, agent);
  const record = tx as {
    transaction?: { signer_id?: string; receiver_id?: string };
    transaction_outcome?: { block_hash?: string };
  } | null;
  const signer = record?.transaction?.signer_id;
  const receiver = record?.transaction?.receiver_id;
  if (signer && signer !== agent) {
    throw new Error(`The transaction signer is ${signer}, and the signed report names ${agent}.`);
  }
  if (receiver && receiver !== body.inputs.contract) {
    throw new Error(`The transaction receiver is ${receiver}, and the signed report names ${body.inputs.contract}.`);
  }
  const args = extractFunctionCallArgs(tx);
  if (!args) throw new Error("The archival transaction did not include registration arguments.");
  let blockHeight: number | undefined;
  const blockHash = record?.transaction_outcome?.block_hash;
  if (blockHash) {
    const block = await client.block(blockHash);
    blockHeight = readHeight(block?.header?.height);
  }
  return { args, blockHeight };
}

function recomputeReport(body: CanonicalReportBody, args: unknown, blockHeight: number | undefined): Report {
  const normalized = normalizeRegistrationArgs(args);
  const compose = normalized?.tcbInfo?.app_compose ? parseCompose(normalized.tcbInfo.app_compose) : null;
  const bundle: EvidenceBundle = {
    target: body.inputs.contract,
    network: body.inputs.network === "offline" ? "testnet" : body.inputs.network,
    shade: "unknown",
    shadeDetail: "Recomputed from the registration transaction. Account views were not re-read.",
    methodsPresent: [],
    registration: normalized
      ? {
          quoteHex: normalized.quoteHex,
          collateral: normalized.collateral,
          checksum: normalized.checksum,
          tcbInfo: normalized.tcbInfo,
          appComposeSha256: normalized.appComposeSha256,
          appComposeRedacted: false,
          agentId: body.inputs.agent ?? undefined,
          txHash: body.inputs.txHash ?? undefined,
          blockHeight,
        }
      : null,
    compose,
    historySource: "none",
    rpcEndpoints: [],
    generatedAt: body.generatedAt,
  };
  const now = new Date(body.generatedAt);
  return buildReport(bundle, { now: Number.isNaN(now.getTime()) ? new Date(0) : now });
}

function compareRegistrationChecks(
  body: CanonicalReportBody,
  recomputed: Report,
): { mismatches: LadderMismatch[]; compared: number } {
  const mismatches: LadderMismatch[] = [];
  let compared = 0;
  const signedById = new Map(body.checks.map((check) => [check.id, check.ladder]));
  const freshById = new Map(recomputed.findings.map((finding) => [finding.id, finding.ladder]));
  for (const id of REGISTRATION_CHECK_IDS) {
    const signed = signedById.get(id);
    const fresh = freshById.get(id);
    if (!signed) continue;
    compared += 1;
    if (!fresh) {
      mismatches.push({ id, signed, recomputed: "missing" });
      continue;
    }
    if (signed !== fresh) mismatches.push({ id, signed, recomputed: fresh });
  }
  return { mismatches, compared };
}

function compareBlockHeight(signed: number | null, fetched: number | undefined): boolean | null {
  if (signed === null || signed === undefined || fetched === undefined) return null;
  return signed === fetched;
}

function readHeight(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,16}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}
