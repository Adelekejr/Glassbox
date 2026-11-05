import { existsSync } from "node:fs";
import { extname } from "node:path";
import { auditTarget, isNearAccountId, presentCheck, type AgentCheck, type AuditOptions, type Network } from "core";
import { takeCheckSlot } from "./limit.js";

export interface CheckAgentInput {
  target: string;
  network?: Network;
  /** Rejected. Callers cannot choose a collateral host. */
  pccsUrl?: unknown;
  pccs?: unknown;
  pccs_url?: unknown;
  collateralUrl?: unknown;
  fetch?: unknown;
  rpcEndpoints?: unknown;
}

const MAX_TARGET_CHARS = 2_000_000;

export const CHECK_AGENT_DESCRIPTION =
  "Read-only audit of one NEAR account id or one JSON registration. Returns overall, a one-sentence summary, and the report. No transaction is sent. A collateral URL cannot be supplied.";

export const CHECK_AGENT_TARGET_DESCRIPTION =
  "NEAR account id, such as ac-sandbox.votron.testnet, or JSON text. A .json file path is accepted. Other paths are refused. A .testnet suffix selects testnet. A .near suffix selects mainnet.";

/**
 * One read-only audit.
 * Account ids are checked. URLs are refused. The PCCS host stays the built-in one.
 * Other existing paths are rejected so a prompt cannot use this tool to read keys or `.env`.
 */
export async function checkAgent(input: CheckAgentInput, options: AuditOptions = {}): Promise<AgentCheck> {
  if (
    input.pccsUrl !== undefined ||
    input.pccs !== undefined ||
    input.pccs_url !== undefined ||
    input.collateralUrl !== undefined ||
    input.fetch !== undefined ||
    input.rpcEndpoints !== undefined ||
    options.fetch !== undefined ||
    options.rpcEndpoints !== undefined
  ) {
    throw new Error("A caller-supplied collateral or RPC URL is not accepted.");
  }
  const target = input.target.trim();
  if (target.length === 0 || target.length > MAX_TARGET_CHARS || target.includes("\0")) {
    throw new Error("target must be a NEAR account id, pasted JSON, or a .json file, and must be at most 2 MB.");
  }
  if (isUrl(target)) {
    throw new Error("URLs are not accepted. Pass a NEAR account id or JSON text.");
  }
  const jsonText = target.startsWith("{") || target.startsWith("[");
  const jsonFile = !jsonText && existsSync(target) && extname(target).toLowerCase() === ".json";
  if (!jsonText && existsSync(target) && !jsonFile) {
    throw new Error("Local files must end in .json. Pass a NEAR account id or paste JSON text.");
  }
  if (!jsonText && !jsonFile && !isNearAccountId(target)) {
    throw new Error("target must be a NEAR account id or JSON text.");
  }
  if (!takeCheckSlot()) {
    throw new Error("Too many check_agent calls in this process. Wait a minute and retry.");
  }
  const report = await auditTarget(target, {
    network: input.network ?? options.network,
    now: options.now,
    skipFreshCollateral: options.skipFreshCollateral,
    skipHistory: options.skipHistory,
    skipMpc: options.skipMpc,
    nearblocksIntervalMs: options.nearblocksIntervalMs,
    rpcIntervalMs: options.rpcIntervalMs,
    finality: options.finality,
  });
  return presentCheck(report);
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//");
}
