import type { AccessKeyView, Network } from "../types.js";
import { AccountNotFoundError } from "./errors.js";

export interface NearClientOptions {
  network: Network;
  archival?: boolean;
  fetch?: typeof fetch;
  minIntervalMs?: number;
  endpoints?: string[];
  sleep?: (ms: number) => Promise<void>;
  /** Public audits use final. A one-node sandbox often has not finalized the latest block yet. */
  finality?: "final" | "optimistic";
}

export interface ViewResult {
  ok: boolean;
  reason?: "method_not_found" | "execution_error";
  message?: string;
  value?: unknown;
}

const PUBLIC_RPC: Record<Network, string[]> = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
};

const ARCHIVAL_RPC: Record<Network, string[]> = {
  testnet: ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org"],
  mainnet: ["https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"],
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read-only NEAR JSON-RPC. Tries FastNEAR, then near.org.
 * Calls are spaced so a single audit stays polite on the public endpoints.
 * This client never signs and never sends a transaction.
 */
export class NearClient {
  readonly network: Network;
  readonly endpoints: string[];
  readonly endpointLog: string[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly finality: "final" | "optimistic";
  private tail: Promise<void> = Promise.resolve();
  private nextAt = 0;

  constructor(options: NearClientOptions) {
    this.network = options.network;
    this.endpoints =
      options.endpoints ??
      (options.archival ? ARCHIVAL_RPC[options.network] : PUBLIC_RPC[options.network]);
    this.fetchImpl = options.fetch ?? fetch;
    this.minIntervalMs = options.minIntervalMs ?? (options.archival ? 1000 : 300);
    this.sleep = options.sleep ?? defaultSleep;
    this.finality = options.finality ?? "final";
  }

  private pace(): Promise<void> {
    const run = this.tail.then(async () => {
      const wait = Math.max(0, this.nextAt - Date.now());
      this.nextAt = Date.now() + this.minIntervalMs;
      if (wait > 0) await this.sleep(wait);
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async call(method: string, params: unknown): Promise<unknown> {
    let last = "no endpoint answered";
    for (const url of this.endpoints) {
      await this.pace();
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "glassbox", method, params }),
        });
        const text = await response.text();
        if (response.status === 429 || response.status >= 500) {
          last = `${url} HTTP ${response.status}`;
          continue;
        }
        if (!response.ok) {
          last = `${url} HTTP ${response.status}`;
          continue;
        }
        const json = JSON.parse(text) as {
          result?: unknown;
          error?: { cause?: { name?: string }; message?: string; data?: unknown };
        };
        if (json.error) {
          const blob = JSON.stringify(json.error);
          const name = json.error.cause?.name ?? "";
          if (name === "UNKNOWN_ACCOUNT" || /UNKNOWN_ACCOUNT|does not exist/i.test(blob)) {
            const account = readAccountId(params);
            throw new AccountNotFoundError(account, this.network);
          }
          if (/TIMEOUT|SERVER_ERROR/i.test(blob)) {
            last = `${url} ${blob.slice(0, 180)}`;
            continue;
          }
          throw new Error(blob);
        }
        this.endpointLog.push(url);
        return json.result;
      } catch (error) {
        if (error instanceof AccountNotFoundError) throw error;
        if (error instanceof Error && error.message.startsWith("{")) throw error;
        last = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`NEAR RPC failed (${this.network}): ${last}`);
  }

  async viewAccount(accountId: string): Promise<{
    code_hash?: string;
    global_contract_hash?: string | null;
    storage_usage?: number;
  }> {
    const result = (await this.call("query", {
      request_type: "view_account",
      finality: this.finality,
      account_id: accountId,
    })) as { code_hash?: string; global_contract_hash?: string | null; storage_usage?: number };
    return result ?? {};
  }

  async viewFunction(accountId: string, methodName: string, args: unknown = {}): Promise<ViewResult> {
    const result = (await this.call("query", {
      request_type: "call_function",
      finality: this.finality,
      account_id: accountId,
      method_name: methodName,
      args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64"),
    })) as { result?: number[] | string; error?: string } | null;
    if (!result) return { ok: true, value: null };
    if (result.error) {
      const message = String(result.error);
      if (message.includes("MethodNotFound")) {
        return { ok: false, reason: "method_not_found", message };
      }
      return { ok: false, reason: "execution_error", message };
    }
    if (result.result === undefined) return { ok: true, value: null };
    const buf = Array.isArray(result.result)
      ? Buffer.from(result.result)
      : Buffer.from(String(result.result), "base64");
    const text = buf.toString("utf8");
    if (!text) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: true, value: text };
    }
  }

  async accessKeys(accountId: string): Promise<AccessKeyView[]> {
    const result = (await this.call("query", {
      request_type: "view_access_key_list",
      finality: this.finality,
      account_id: accountId,
    })) as { keys?: AccessKeyView[] } | null;
    return result?.keys ?? [];
  }

  async transaction(hash: string, signerId: string): Promise<unknown> {
    return this.call("tx", [hash, signerId]);
  }

  async block(blockId: string): Promise<{ header?: { height?: number | string; timestamp?: number | string } } | null> {
    const result = (await this.call("block", { block_id: blockId })) as {
      header?: { height?: number | string; timestamp?: number | string };
    } | null;
    return result;
  }
}

function readAccountId(params: unknown): string {
  if (params && typeof params === "object" && "account_id" in params) {
    const id = (params as { account_id?: unknown }).account_id;
    if (typeof id === "string") return id;
  }
  return "(unknown account)";
}

export function methodExists(view: ViewResult): boolean {
  return view.ok || view.reason === "execution_error";
}
