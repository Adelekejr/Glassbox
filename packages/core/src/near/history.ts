import type { Network } from "../types.js";
import { NearClient } from "./rpc.js";

export interface HistoryCall {
  hash: string;
  signer: string;
  timestampNs?: string;
  success: boolean;
  method?: string;
  args?: unknown;
  /** True when the index row had no arguments and the archival transaction read failed. */
  argsUnreadable?: boolean;
}

export interface HistoryPage {
  calls: HistoryCall[];
  source: "fastnear" | "nearblocks";
  /** True when the NearBlocks API was called. The report must attribute it. */
  usedNearblocks: boolean;
  /** True when this page was served from the in-process cache. */
  fromCache?: boolean;
  /** Age of the cached page, in milliseconds. Set only when fromCache is true. */
  cacheAgeMs?: number;
}

export interface HistoryOptions {
  fetch?: typeof fetch;
  /** Minimum gap between NearBlocks calls. Default respects the free 6/minute cap. */
  nearblocksIntervalMs?: number;
  /** Gap between archival RPC reads used to recover call arguments. */
  rpcIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Human age for a cached history page. Sub-minute ages stay "under a minute". */
export function formatHistoryCacheAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return "under a minute";
  const minutes = Math.round(ageMs / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

const NEARBLOCKS: Record<Network, string> = {
  testnet: "https://api-testnet.nearblocks.io",
  mainnet: "https://api.nearblocks.io",
};

let nearblocksTail: Promise<void> = Promise.resolve();
let nearblocksNextAt = 0;

const historyCache = new Map<string, { at: number; page: HistoryPage }>();
const DEFAULT_CACHE_MS = 10 * 60 * 1000;
const MAX_HISTORY_CACHE = 200;

function rememberHistory(key: string, page: HistoryPage): void {
  historyCache.delete(key);
  while (historyCache.size >= MAX_HISTORY_CACHE) {
    const oldest = historyCache.keys().next().value;
    if (oldest === undefined) break;
    historyCache.delete(oldest);
  }
  historyCache.set(key, { at: Date.now(), page });
}

function cacheTtlMs(): number {
  const raw = process.env.GLASSBOX_HISTORY_CACHE_MS;
  if (!raw) return DEFAULT_CACHE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_MS;
}

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
  historyCache.clear();
}

/**
 * On-demand history for one account and one method.
 * FastNEAR's tx index is tried first. An empty list, or a list with no row for
 * this method, falls through. NearBlocks v3 no longer serves `/v1/account/…/txns`
 * on testnet (HTTP 410). The method-filtered list is
 * `/v3/accounts/…/receipts?method=`, because `/v3/accounts/…/txns` does not
 * filter by method and its rows omit call arguments. The parser also accepts
 * the v3 transaction-list shape (`data`, `signer_account_id`). Arguments are
 * read from the archival `tx` RPC once the hash and signer are kept.
 */
export async function listMethodCalls(
  network: Network,
  accountId: string,
  method: string,
  options: HistoryOptions = {},
): Promise<HistoryPage> {
  const key = `${network}:${accountId}:${method}`;
  const ttl = cacheTtlMs();
  const hit = historyCache.get(key);
  if (hit && ttl > 0 && Date.now() - hit.at < ttl) {
    return { ...hit.page, fromCache: true, cacheAgeMs: Date.now() - hit.at };
  }
  const fetchImpl = options.fetch ?? fetch;
  const fast = await tryFastnear(fetchImpl, network, accountId, method);
  const page = fast ?? {
    calls: await fetchNearblocks(fetchImpl, network, accountId, method, options),
    source: "nearblocks" as const,
    usedNearblocks: true,
  };
  await fillMissingArgs(network, page.calls, fetchImpl, options);
  rememberHistory(key, page);
  return page;
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
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    const calls = parseFastnear(body, method);
    // An empty list, or rows for other methods, is not an answer for this method.
    if (!calls || calls.length === 0) return null;
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
    const rowMethod = stringField(record, ["method", "method_name"]) ?? methodOnActions(record, method);
    if (rowMethod !== method) continue;
    const hash = stringField(record, ["transaction_hash", "hash", "tx_hash", "id"]);
    const signer = stringField(record, ["signer_account_id", "signer_id", "predecessor_account_id", "signer", "predecessor"]);
    if (!hash || !signer) continue;
    calls.push({
      hash,
      signer,
      timestampNs: stringField(record, ["block_timestamp", "timestamp"]),
      success: record.status !== false && record.success !== false,
      method,
    });
  }
  return calls.length > 0 ? calls : null;
}

function methodOnActions(record: Record<string, unknown>, method: string): string | undefined {
  if (!Array.isArray(record.actions)) return undefined;
  for (const action of record.actions) {
    if (!action || typeof action !== "object") continue;
    if ((action as { method?: unknown }).method === method) return method;
  }
  return undefined;
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
  let next: string | undefined;
  for (let page = 0; page < 2; page += 1) {
    await takeNearblocksSlot(interval, sleep);
    const params = new URLSearchParams({
      method,
      limit: "25",
    });
    if (next) params.set("next", next);
    const url = `${NEARBLOCKS[network]}/v3/accounts/${encodeURIComponent(accountId)}/receipts?${params}`;
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "glassbox-auditor/0.1",
      },
      redirect: "error",
    });
    if (response.status === 429) {
      throw new Error("NearBlocks rate limit (HTTP 429). Glassbox spaces calls; retry this account later.");
    }
    if (!response.ok) {
      throw new Error(`NearBlocks HTTP ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    const parsed = parseNearblocksPage(body, method);
    calls.push(...parsed.calls);
    if (!parsed.next || parsed.rowCount === 0) break;
    next = parsed.next;
  }
  return calls;
}

/**
 * v3 lists put rows under `data` (v1 used `txns`). A transaction-list row signs
 * with `signer_account_id`. A receipt row signs with `predecessor_account_id`.
 * List items name the method and do not include call arguments.
 */
export function parseNearblocksPage(
  body: unknown,
  method: string,
): { calls: HistoryCall[]; next?: string; rowCount: number } {
  if (!body || typeof body !== "object") return { calls: [], rowCount: 0 };
  const record = body as Record<string, unknown>;
  const rows = arrayField(record, ["data", "txns"]);
  const meta = record.meta && typeof record.meta === "object" ? (record.meta as Record<string, unknown>) : undefined;
  const next = (meta ? stringField(meta, ["next_page"]) : undefined) ?? stringField(record, ["cursor"]);
  const calls: HistoryCall[] = [];
  for (const row of rows) {
    const call = parseNearblocksRow(row, method);
    if (call) calls.push(call);
  }
  return { calls, next, rowCount: rows.length };
}

function parseNearblocksRow(row: unknown, method: string): HistoryCall | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const hash = stringField(record, ["transaction_hash", "hash"]);
  const signer = stringField(record, ["signer_account_id", "predecessor_account_id"]);
  if (!hash || !signer) return null;
  const actions = Array.isArray(record.actions) ? record.actions : [];
  const action = actions.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as { method?: string }).method === method;
  }) as { method?: string; args?: unknown } | undefined;
  if (actions.length > 0 && !action) return null;
  const outcome = statusOf(record.outcomes) ?? statusOf(record.outcome) ?? statusOf(record.receipt_outcome);
  const success = outcome !== false;
  const block = record.block && typeof record.block === "object" ? (record.block as Record<string, unknown>) : undefined;
  return {
    hash,
    signer,
    timestampNs:
      stringField(record, ["block_timestamp", "included_in_block_timestamp"]) ??
      (block ? stringField(block, ["block_timestamp"]) : undefined),
    success,
    method,
    args: action ? decodeArgs(action.args) : undefined,
  };
}

async function fillMissingArgs(
  network: Network,
  calls: HistoryCall[],
  fetchImpl: typeof fetch,
  options: HistoryOptions,
): Promise<void> {
  const missing = calls.filter((call) => call.success && call.args === undefined);
  if (missing.length === 0) return;
  const archival = new NearClient({
    network,
    archival: true,
    fetch: fetchImpl,
    minIntervalMs: options.rpcIntervalMs ?? 1000,
    sleep: options.sleep,
  });
  for (const call of missing) {
    try {
      const tx = await archival.transaction(call.hash, call.signer);
      const extracted = extractFunctionCallArgs(tx);
      if (extracted !== null && extracted !== undefined) call.args = extracted;
    } catch {
      call.argsUnreadable = true;
    }
  }
}

function arrayField(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function statusOf(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === "boolean" ? status : undefined;
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
