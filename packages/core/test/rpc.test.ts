import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AccountNotFoundError } from "../src/near/errors.js";
import { listMethodCalls, resetNearblocksLimiter } from "../src/near/history.js";
import { methodExists, NearClient } from "../src/near/rpc.js";

const codeDoesNotExist = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/code-does-not-exist.json"), "utf8"),
) as { callFunctionError: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("RPC falls back when the first public endpoint fails", async () => {
  const urls: string[] = [];
  const slept: number[] = [];
  const client = new NearClient({
    network: "testnet",
    endpoints: ["https://rpc.first.example", "https://rpc.second.example"],
    minIntervalMs: 15,
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("first")) return jsonResponse({ error: "busy" }, 503);
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { code_hash: "abc", storage_usage: 10 },
      });
    },
  });
  const account = await client.viewAccount("ac-sandbox.votron.testnet");
  assert.equal(account.code_hash, "abc");
  assert.deepEqual(urls, ["https://rpc.first.example", "https://rpc.second.example"]);
  await client.viewAccount("ac-sandbox.votron.testnet");
  assert.ok(slept.some((ms) => ms > 0));
});

test("a missing account is not retried as an endpoint failure", async () => {
  let calls = 0;
  const client = new NearClient({
    network: "testnet",
    endpoints: ["https://rpc.a.example", "https://rpc.b.example"],
    minIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async () => {
      calls += 1;
      return jsonResponse({
        jsonrpc: "2.0",
        error: { cause: { name: "UNKNOWN_ACCOUNT" }, message: "account missing" },
      });
    },
  });
  await assert.rejects(() => client.viewAccount("missing.testnet"), AccountNotFoundError);
  assert.equal(calls, 1);
});

test("approve and remove history is cached so NearBlocks is not called twice", async () => {
  resetNearblocksLimiter();
  let nearblocksCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("fastnear")) return jsonResponse({}, 404);
    nearblocksCalls += 1;
    return jsonResponse({
      txns: [
        {
          transaction_hash: "histotx",
          predecessor_account_id: "owner.testnet",
          block_timestamp: "1750000000000000000",
          outcomes: { status: true },
          receipt_outcome: { status: true },
          actions: [{ method: "remove_measurements", args: "{\"measurements\":{\"rtmrs\":{\"mrtd\":\"aa\"}}}" }],
        },
      ],
    });
  };
  const first = await listMethodCalls("testnet", "shade.testnet", "remove_measurements", {
    fetch: fetchImpl,
    nearblocksIntervalMs: 0,
    sleep: async () => undefined,
  });
  const second = await listMethodCalls("testnet", "shade.testnet", "remove_measurements", {
    fetch: fetchImpl,
    nearblocksIntervalMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(nearblocksCalls, 1);
  assert.equal(first.fromCache, undefined);
  assert.equal(second.fromCache, true);
  assert.equal(second.calls[0]?.hash, "histotx");
  assert.equal(second.calls[0]?.signer, "owner.testnet");
  assert.equal(second.usedNearblocks, true);
});

test("NEAR RPC and history fetches pass redirect error", async () => {
  const rpcInits: Array<RequestInit | undefined> = [];
  const client = new NearClient({
    network: "testnet",
    endpoints: ["https://rpc.example"],
    minIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (_input, init) => {
      rpcInits.push(init);
      return jsonResponse({ jsonrpc: "2.0", result: { code_hash: "abc" } });
    },
  });
  await client.viewAccount("redirect.testnet");
  assert.equal(rpcInits.length, 1);
  assert.equal(rpcInits[0]?.redirect, "error");

  const historyCalls: Array<{ url: string; redirect: RequestInit["redirect"] }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    historyCalls.push({ url, redirect: init?.redirect });
    if (url.includes("fastnear")) return jsonResponse({}, 404);
    return jsonResponse({ txns: [] });
  };
  await listMethodCalls("testnet", "redirect-history.testnet", "approve_codehash", {
    fetch: fetchImpl,
    nearblocksIntervalMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(historyCalls.length, 2);
  assert.ok(historyCalls.some((call) => call.url.includes("fastnear")));
  assert.ok(historyCalls.some((call) => call.url.includes("nearblocks.io")));
  for (const call of historyCalls) {
    assert.equal(call.redirect, "error");
  }
});

test("method-not-found is distinct from a panic, which means the method exists", async () => {
  const client = new NearClient({
    network: "testnet",
    endpoints: ["https://rpc.example"],
    minIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { params: { method_name: string } };
      if (body.params.method_name === "get_contract_info") {
        return jsonResponse({
          result: {
            result: [],
            error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
            logs: [],
          },
        });
      }
      return jsonResponse({
        result: {
          result: [],
          error: 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "no agent" })',
          logs: [],
        },
      });
    },
  });
  const missing = await client.viewFunction("ac-sandbox.votron.testnet", "get_contract_info", {});
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "method_not_found");
  const present = await client.viewFunction("ac-sandbox.votron.testnet", "get_agent", {});
  assert.equal(present.ok, false);
  assert.equal(present.reason, "execution_error");
  const panicClient = new NearClient({
    network: "testnet",
    endpoints: ["https://rpc.example"],
    minIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async () =>
      jsonResponse({
        result: {
          result: [],
          error: 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "MethodNotFound" })',
          logs: [],
        },
      }),
  });
  const panicked = await panicClient.viewFunction("shade.test.near", "remove_codehash", {});
  assert.equal(panicked.ok, false);
  assert.equal(panicked.reason, "execution_error");
  const encoded = Buffer.from(JSON.stringify({ checksum: "aa", codehash: "bb" }), "utf8");
  const okClient = new NearClient({
    network: "testnet",
    endpoints: ["https://rpc.example"],
    minIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async () =>
      jsonResponse({
        result: { result: [...encoded], logs: [] },
      }),
  });
  const view = await okClient.viewFunction("ac-sandbox.votron.testnet", "get_agent", {});
  assert.equal(view.ok, true);
  assert.deepEqual(view.value, { checksum: "aa", codehash: "bb" });
});

test("CodeDoesNotExist is not an execution error, and a panic that mentions it still is", async () => {
  const client = new NearClient({
    network: "mainnet",
    endpoints: ["https://rpc.example"],
    minIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { params: { method_name: string } };
      const error =
        body.params.method_name === "get_agent"
          ? 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "CodeDoesNotExist" })'
          : codeDoesNotExist.callFunctionError;
      return jsonResponse({ result: { result: [], error, logs: [] } });
    },
  });
  const missing = await client.viewFunction("ironshield.near", "get_contract_info", {});
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "code_does_not_exist");
  assert.equal(methodExists(missing), false);
  assert.match(missing.message ?? "", /CompilationError\(CodeDoesNotExist/);
  const panicked = await client.viewFunction("ironshield.near", "get_agent", {});
  assert.equal(panicked.ok, false);
  assert.equal(panicked.reason, "execution_error");
  assert.equal(methodExists(panicked), true);
});
