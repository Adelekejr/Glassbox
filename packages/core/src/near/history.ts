import type { Network } from "../types.js";

export interface HistoryCall {
  hash: string;
  signer: string;
  timestampNs?: string;
  success: boolean;
  method?: string;
  args?: unknown;
}

export interface HistoryPage {
  calls: HistoryCall[];
  source: "fastnear" | "nearblocks";
  /** True when the NearBlocks API was called. The report must attribute it. */
  usedNearblocks: boolean;
}

export interface HistoryOptions {
  fetch?: typeof fetch;
  /** Minimum gap between NearBlocks calls. Default respects the free 6/minute cap. */
  nearblocksIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const NEARBLOCKS: Record<Network, string> = {
  testnet: "https://api-testnet.nearblocks.io",
  mainnet: "https://api.nearblocks.io",
};

let nearblocksTail: Promise<void> = Promise.resolve();
let nearblocksNextAt = 0;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeNearblocksSlot(intervalMs: number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const run = nearblocksTail.then(async () => {
    const wait = Math.max(0, nearblocksNextAt - Date.now());
    nearblocksNextAt = Date.now() + intervalMs;
    if (wait > 0) await sleep(wait);
  });
  nearblocksTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Test hook. Production code does not need to reset this. */
export function resetNearblocksLimiter(): void {
  nearblocksTail = Promise.resolve();
  nearblocksNextAt = 0;
}

/**
 * On-demand history for one account and one method.
 * FastNEAR's tx index (tx.test/main.fastnear.com/v0/account) returned HTTP 404
 * on 2026-11-04, so a miss falls through to NearBlocks.
 */
export async function listMethodCalls(
  network: Network,
  accountId: string,
  method: string,
  options: HistoryOptions = {},
): Promise<HistoryPage> {
  const fetchImpl = options.fetch ?? fetch;
  const fast = await tryFastnear(fetchImpl, network, accountId, method);
  if (fast) return fast;
  const calls = await fetchNearblocks(fetchImpl, network, accountId, method, options);
  return { calls, source: "nearblocks", usedNearblocks: true };
}

async function tryFastnear(
  fetchImpl: typeof fetch,
  network: Network,
  accountId: string,
  method: string,
): Promise<HistoryPage | null> {
  const host = network === "testnet" ? "https://tx.test.fastnear.com" : "https://tx.main.fastnear.com";
  const url = `${host}/v0/account/${encodeURIComponent(accountId)}`;
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const calls = parseFastnear(body, method);
    if (!calls) return null;
    return { calls, source: "fastnear", usedNearblocks: false };
  } catch {
    return null;
  }
}

function parseFastnear(body: unknown, method: string): HistoryCall[] | null {
  const rows = findTxArrays(body);
  if (!rows) return null;
  const calls: HistoryCall[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const rowMethod = stringField(record, ["method", "method_name"]);
    if (rowMethod && rowMethod !== method) continue;
    const hash = stringField(record, ["transaction_hash", "hash", "tx_hash", "id"]);
    const signer = stringField(record, ["signer_id", "predecessor_account_id", "signer", "predecessor"]);
    if (!hash || !signer) continue;
    calls.push({
      hash,
      signer,
      timestampNs: stringField(record, ["block_timestamp", "timestamp"]),
      success: record.status !== false && record.success !== false,
      method: rowMethod ?? method,
    });
  }
  return calls;
}

function findTxArrays(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["txs", "txns", "transactions", "items", "data"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return null;
}

async function fetchNearblocks(
  fetchImpl: typeof fetch,
  network: Network,
  accountId: string,
  method: string,
  options: HistoryOptions,
): Promise<HistoryCall[]> {
  const interval = options.nearblocksIntervalMs ?? 10_500;
  const sleep = options.sleep ?? defaultSleep;
  const calls: HistoryCall[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 2; page += 1) {
    await takeNearblocksSlot(interval, sleep);
    const params = new URLSearchParams({
      method,
      per_page: "25",
      order: "desc",
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${NEARBLOCKS[network]}/v1/account/${encodeURIComponent(accountId)}/txns?${params}`;
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "glassbox-auditor/0.1",
      },
    });
    if (response.status === 429) {
      throw new Error("NearBlocks rate limit (HTTP 429). Glassbox spaces calls; retry this account later.");
    }
    if (!response.ok) {
      throw new Error(`NearBlocks HTTP ${response.status} for ${accountId} ${method}.`);
    }
    const body = (await response.json()) as { cursor?: string; txns?: unknown[] };
    for (const row of body.txns ?? []) {
      const call = parseNearblocksRow(row, method);
      if (call) calls.push(call);
    }
    if (!body.cursor || (body.txns ?? []).length === 0) break;
    cursor = body.cursor;
  }
  return calls;
}

function parseNearblocksRow(row: unknown, method: string): HistoryCall | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const hash = stringField(record, ["transaction_hash"]);
  const signer = stringField(record, ["predecessor_account_id"]);
  if (!hash || !signer) return null;
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const action = actions.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as { method?: string }).method === method;
  }) as { method?: string; args?: unknown } | undefined;
  const outcomes = record.outcomes as { status?: boolean } | undefined;
  const receipt = record.receipt_outcome as { status?: boolean } | undefined;
  const success = outcomes?.status !== false && receipt?.status !== false;
  return {
    hash,
    signer,
    timestampNs: stringField(record, ["block_timestamp"]),
    success,
    method,
    args: decodeArgs(action?.args),
  };
}

function decodeArgs(args: unknown): unknown {
  if (typeof args !== "string") return args;
  const parsed = tryJson(args);
  if (typeof parsed === "string") return tryJson(parsed);
  return parsed;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function extractFunctionCallArgs(txResult: unknown): unknown | null {
  if (!txResult || typeof txResult !== "object") return null;
  const transaction = (txResult as { transaction?: { actions?: unknown[] } }).transaction;
  const actions = transaction?.actions ?? [];
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const record = action as Record<string, unknown>;
    const fc = (record.FunctionCall ?? record.function_call) as { args?: string } | undefined;
    if (!fc?.args || typeof fc.args !== "string") continue;
    const raw = Buffer.from(fc.args, "base64").toString("utf8");
    return tryJson(raw);
  }
  return null;
}
