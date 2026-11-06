import { auditAccount, auditValue, isNearAccountId, presentCheck, type AgentCheck, type AuditOptions, type Network } from "core";
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
  "Read-only audit of one NEAR account id or one pasted JSON registration. Returns overall, a one-sentence summary, and the report. No transaction is sent. Local files are not read. A collateral URL cannot be supplied.";

export const CHECK_AGENT_TARGET_DESCRIPTION =
  "NEAR account id, such as ac-sandbox.votron.testnet, or pasted JSON text. Local file paths are not accepted. A .testnet suffix selects testnet. A .near suffix selects mainnet.";

/**
 * One read-only audit.
 * Account ids are checked. URLs and local paths are refused. The PCCS host stays the built-in one.
 * This tool does not read the filesystem. Paste JSON instead of passing a path.
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
    throw new Error("target must be a NEAR account id or pasted JSON, and must be at most 2 MB. Local file paths are not accepted.");
  }
  if (isUrl(target)) {
    throw new Error("URLs are not accepted. Pass a NEAR account id or JSON text.");
  }
  const jsonText = target.startsWith("{") || target.startsWith("[");
  if (!jsonText && !isNearAccountId(target)) {
    throw new Error("target must be a NEAR account id or pasted JSON text. Local file paths are not accepted.");
  }
  if (!takeCheckSlot()) {
    throw new Error("Too many check_agent calls in this process. Wait a minute and retry.");
  }
  // Same split as the web route. auditTarget also opens a path that exists on disk.
  const auditOptions: AuditOptions = {
    network: input.network ?? options.network,
    now: options.now,
    skipFreshCollateral: options.skipFreshCollateral,
    skipHistory: options.skipHistory,
    skipMpc: options.skipMpc,
    nearblocksIntervalMs: options.nearblocksIntervalMs,
    rpcIntervalMs: options.rpcIntervalMs,
    finality: options.finality,
  };
  const report = jsonText ? await auditPastedJson(target, auditOptions) : await auditAccount(target, auditOptions);
  return presentCheck(report);
}

async function auditPastedJson(target: string, options: AuditOptions) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(target) as unknown;
  } catch {
    throw new Error("Pasted JSON could not be parsed.");
  }
  return auditValue(parsed, { ...options, label: "pasted-json" });
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("//");
}
