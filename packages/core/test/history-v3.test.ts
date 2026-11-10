import assert from "node:assert/strict";
import test from "node:test";
import { auditAccount } from "../src/audit.js";
import { listMethodCalls, parseNearblocksPage, resetNearblocksLimiter } from "../src/near/history.js";
import { isLiveChainProof } from "../src/provenance.js";
import { formatReport } from "../src/report.js";

const CODEHASH = "ab".repeat(32);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function rpc(result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id: "glassbox", result });
}

function viewValue(value: unknown): Response {
  return rpc({ result: [...Buffer.from(JSON.stringify(value), "utf8")], logs: [] });
}

function methodNotFound(): Response {
  return rpc({
    result: [],
    error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
    logs: [],
  });
}

test("v3 history keeps hash and signer, falls through an empty FastNEAR list, and does not treat a failed read as an empty index", async () => {
  resetNearblocksLimiter();
  const parsed = parseNearblocksPage(
    {
      data: [
        {
          transaction_hash: "hash1",
          signer_account_id: "agent.testnet",
          block_timestamp: "1750000000000000000",
          outcomes: { status: true },
          actions: [{ action: "FUNCTION_CALL", method: "register_agent" }],
        },
        {
          transaction_hash: "hash2",
          predecessor_account_id: "receipt.testnet",
          included_in_block_timestamp: "1750000000000000001",
          outcome: { status: true },
          actions: [{ action: "FUNCTION_CALL", method: "register_agent" }],
        },
        {
          transaction_hash: "hash3",
          signer_account_id: "other.testnet",
          actions: [{ method: "get_agent" }],
        },
        { transaction_hash: "hash4" },
      ],
      meta: { next_page: "cursor1" },
    },
    "register_agent",
  );
  assert.deepEqual(
    parsed.calls.map((call) => call.signer),
    ["agent.testnet", "receipt.testnet"],
  );
  assert.equal(parsed.calls[0]?.hash, "hash1");
  assert.equal(parsed.calls[0]?.args, undefined);
  assert.equal(parsed.next, "cursor1");
  assert.equal(parsed.rowCount, 4);

  const urls: string[] = [];
  const v3 = await listMethodCalls("testnet", "parse-v3.testnet", "register_agent", {
    nearblocksIntervalMs: 0,
    rpcIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("://tx.")) return jsonResponse({ data: [] });
      if (url.includes("nearblocks.io")) {
        return jsonResponse({
          data: [
            {
              transaction_hash: "regtx",
              signer_account_id: "agent.testnet",
              block_timestamp: "1750000000000000000",
              outcomes: { status: true },
              actions: [{ action: "FUNCTION_CALL", method: "register_agent" }],
            },
          ],
          meta: {},
        });
      }
      const body = JSON.parse(String(init?.body)) as { method: string; params: [string, string] };
      assert.equal(body.method, "tx");
      assert.deepEqual(body.params, ["regtx", "agent.testnet"]);
      const args = Buffer.from(JSON.stringify({ quote_hex: "abcd" }), "utf8").toString("base64");
      return rpc({
        transaction: { actions: [{ FunctionCall: { args, method_name: "register_agent", gas: "1", deposit: "0" } }] },
      });
    },
  });
  assert.equal(v3.calls[0]?.signer, "agent.testnet");
  assert.equal(v3.calls[0]?.hash, "regtx");
  assert.deepEqual(v3.calls[0]?.args, { quote_hex: "abcd" });
  assert.equal(v3.usedNearblocks, true);
  assert.ok(urls.some((url) => url.includes("/v3/accounts/parse-v3.testnet/receipts?")));
  assert.ok(urls.some((url) => url.includes("method=register_agent")));
  assert.equal(
    urls.filter((url) => url.includes("nearblocks.io")).length,
    1,
  );

  resetNearblocksLimiter();
  const fallthroughUrls: string[] = [];
  await listMethodCalls("testnet", "empty-fastnear.testnet", "approve_codehash", {
    nearblocksIntervalMs: 0,
    rpcIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (input) => {
      const url = String(input);
      fallthroughUrls.push(url);
      if (url.includes("://tx.")) return jsonResponse({ txs: [] });
      return jsonResponse({
        data: [
          {
            transaction_hash: "kept",
            signer_account_id: "owner.testnet",
            outcomes: { status: true },
            actions: [{ method: "approve_codehash", args: "{\"codehash\":\"cc\"}" }],
          },
        ],
      });
    },
  });
  assert.ok(fallthroughUrls.some((url) => url.includes("://tx.")));
  assert.ok(fallthroughUrls.some((url) => url.includes("nearblocks.io")));

  resetNearblocksLimiter();
  const otherMethodUrls: string[] = [];
  const matched = await listMethodCalls("testnet", "other-method.testnet", "approve_codehash", {
    nearblocksIntervalMs: 0,
    rpcIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (input) => {
      const url = String(input);
      otherMethodUrls.push(url);
      if (url.includes("://tx.")) {
        return jsonResponse({
          txs: [{ transaction_hash: "viewtx", signer_id: "owner.testnet", method: "get_agent" }],
        });
      }
      return jsonResponse({ data: [], meta: {} });
    },
  });
  assert.equal(matched.calls.length, 0);
  assert.equal(matched.source, "nearblocks");
  assert.ok(otherMethodUrls.some((url) => url.includes("nearblocks.io")));

  resetNearblocksLimiter();
  let fastnearRowsStop = 0;
  await listMethodCalls("testnet", "fastnear-hit.testnet", "approve_codehash", {
    nearblocksIntervalMs: 0,
    rpcIntervalMs: 0,
    sleep: async () => undefined,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("://tx.")) {
        return jsonResponse({
          txs: [
            {
              transaction_hash: "fasttx",
              signer_account_id: "owner.testnet",
              method: "approve_codehash",
            },
          ],
        });
      }
      if (url.includes("nearblocks.io")) {
        fastnearRowsStop += 1;
        return jsonResponse({ data: [] });
      }
      const body = JSON.parse(String(init?.body)) as { method: string };
      assert.equal(body.method, "tx");
      const args = Buffer.from(JSON.stringify({ codehash: "dd" }), "utf8").toString("base64");
      return rpc({ transaction: { actions: [{ FunctionCall: { args } }] } });
    },
  });
  assert.equal(fastnearRowsStop, 0);

  const failed = await runAudit("fail-history.testnet", "fail");
  const failedText = formatReport(failed.report);
  const quote = finding(failed.report, "tdx.registration");
  const codehash = finding(failed.report, "codehash.approved");
  const keys = finding(failed.report, "access.keys");
  const removed = finding(failed.report, "contract.remove");
  assert.equal(quote.ladder, "NOT_PROVEN");
  assert.match(quote.plainEnglish, /Could not read history for register_agent/);
  assert.match(quote.plainEnglish, /approve_codehash/);
  assert.match(quote.plainEnglish, /remove_codehash/);
  assert.match(quote.plainEnglish, /not an empty index/);
  assert.match(codehash.plainEnglish, /Could not read history for register_agent, approve_codehash/);
  assert.match(codehash.plainEnglish, /get_agent was not called/);
  assert.equal(codehash.provenance.observationKind, "unavailable");
  assert.match(failed.report.approvalHistoryNote ?? "", /Could not read approve_codehash history/);
  assert.match(failed.report.approvalHistoryNote ?? "", /Could not read remove_codehash history/);
  assert.doesNotMatch(failedText, /No \w+ calls were in the indexed history/);
  assert.doesNotMatch(failedText, /none in the indexed history/);
  assert.doesNotMatch(failedText, /Powered by Nearblocks/);
  assert.doesNotMatch(failedText, /Transaction history: NearBlocks/);
  assert.equal(failed.report.attribution.length, 0);
  assert.match(removed.plainEnglish, /could not be read/i);
  assert.doesNotMatch(removed.plainEnglish, /No remove_codehash calls were in the indexed history/);
  assert.equal(keys.ladder, "RISKY");
  assert.equal(failed.agentFollowUps, 0);
  assert.ok(failed.nearblocksHits > 0);
  assert.ok(failed.fastnearHits > 0);

  resetNearblocksLimiter();
  const first = await runAudit("cache-history.testnet", "ok");
  const firstCodehash = finding(first.report, "codehash.approved");
  assert.equal(firstCodehash.ladder, "PROVEN");
  assert.equal(firstCodehash.provenance.observationKind, "chain");
  assert.match(firstCodehash.provenance.label, /Fresh chain observation/);
  assert.equal(isLiveChainProof(firstCodehash), true);
  assert.doesNotMatch(firstCodehash.plainEnglish, /local cache/);
  assert.equal(finding(first.report, "access.keys").ladder, "RISKY");
  const nearblocksBeforeRepeat = first.nearblocksHits;

  const second = await runAudit("cache-history.testnet", "ok");
  const secondCodehash = finding(second.report, "codehash.approved");
  const secondQuote = finding(second.report, "tdx.registration");
  assert.equal(secondCodehash.ladder, "PROVEN");
  assert.equal(nearblocksBeforeRepeat > 0, true);
  assert.equal(second.nearblocksHits, 0);
  assert.match(secondCodehash.plainEnglish, /local cache \(under a minute old\)/);
  assert.match(secondCodehash.provenance.label, /local cache/);
  assert.match(secondCodehash.provenance.label, /Not a fresh chain observation/);
  assert.equal(secondCodehash.provenance.liveChain, false);
  assert.equal(isLiveChainProof(secondCodehash), false);
  assert.match(secondQuote.plainEnglish, /local history cache \(under a minute old\)/);
  assert.match(secondQuote.provenance.label, /local cache/);
  assert.match(secondQuote.provenance.label, /Not a fresh chain observation/);
  assert.equal(finding(second.report, "access.keys").ladder, "RISKY");
});

async function runAudit(accountId: string, mode: "fail" | "ok"): Promise<{
  report: Awaited<ReturnType<typeof auditAccount>>;
  nearblocksHits: number;
  fastnearHits: number;
  agentFollowUps: number;
}> {
  let nearblocksHits = 0;
  let fastnearHits = 0;
  let agentFollowUps = 0;
  const report = await auditAccount(accountId, {
    skipMpc: true,
    skipFreshCollateral: true,
    nearblocksIntervalMs: 0,
    rpcIntervalMs: 0,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("://tx.test.fastnear.com") || url.includes("://tx.main.fastnear.com")) {
        fastnearHits += 1;
        return jsonResponse({ data: [] });
      }
      if (url.includes("nearblocks.io")) {
        nearblocksHits += 1;
        if (mode === "fail") return jsonResponse({ message: "gone" }, 410);
        const method = new URL(url).searchParams.get("method");
        if (method === "register_agent") {
          return jsonResponse({
            data: [
              {
                transaction_hash: "regtx",
                predecessor_account_id: "agent.testnet",
                included_in_block_timestamp: "1750000000000000000",
                outcome: { status: true },
                actions: [{ action: "FUNCTION_CALL", method: "register_agent" }],
              },
            ],
            meta: {},
          });
        }
        if (method === "approve_codehash") {
          return jsonResponse({
            data: [
              {
                transaction_hash: "approvetx",
                signer_account_id: "owner.testnet",
                block_timestamp: "1750000001000000000",
                outcomes: { status: true },
                actions: [{ action: "FUNCTION_CALL", method: "approve_codehash" }],
              },
            ],
            meta: {},
          });
        }
        return jsonResponse({ data: [], meta: {} });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        method?: string;
        params?: { request_type?: string; method_name?: string; args_base64?: string } | [string, string];
      };
      if (body.method === "tx") {
        const hash = Array.isArray(body.params) ? body.params[0] : "";
        const args = Buffer.from(
          JSON.stringify(hash === "approvetx" ? { codehash: CODEHASH } : { note: "not-a-quote" }),
          "utf8",
        ).toString("base64");
        return rpc({
          transaction: { actions: [{ FunctionCall: { args, method_name: hash, gas: "1", deposit: "0" } }] },
          transaction_outcome: { block_hash: "blockhash" },
        });
      }
      if (body.method === "block") return rpc({ header: { height: 12, timestamp: "1750000000000000000" } });
      const params = body.params && !Array.isArray(body.params) ? body.params : {};
      if (params.request_type === "view_account") return rpc({ code_hash: "abc", storage_usage: 1 });
      if (params.request_type === "view_access_key_list") {
        return rpc({
          keys: [{ public_key: "ed25519:full", access_key: { permission: "FullAccess" } }],
        });
      }
      if (params.request_type === "call_function") {
        if (params.method_name === "get_agent") {
          const decoded = JSON.parse(Buffer.from(params.args_base64 ?? "", "base64").toString("utf8") || "{}") as {
            account_id?: string;
          };
          if (decoded.account_id) {
            agentFollowUps += 1;
            return viewValue({ checksum: "cc", codehash: CODEHASH });
          }
          return rpc({
            result: [],
            error: 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "no agent" })',
            logs: [],
          });
        }
        return methodNotFound();
      }
      return jsonResponse({ error: "unexpected" }, 500);
    },
  });
  return { report, nearblocksHits, fastnearHits, agentFollowUps };
}

function finding(report: Awaited<ReturnType<typeof auditAccount>>, id: string) {
  const item = report.findings.find((entry) => entry.id === id);
  assert.ok(item, id);
  return item;
}
