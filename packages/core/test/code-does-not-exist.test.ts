import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditAccount } from "../src/audit.js";
import type { Report } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/code-does-not-exist.json"), "utf8")) as {
  accountId: string;
  codeHash: string;
  callFunctionError: string;
};
const FROZEN = new Date("2026-11-10T12:00:00.000Z");
const PANIC = 'wasm execution failed with error: HostError(GuestPanic { panic_msg: "no agent" })';
const PANIC_NAMES_CODE =
  'wasm execution failed with error: HostError(GuestPanic { panic_msg: "CodeDoesNotExist" })';
const DEPLOYED_HASH = "7EUTZnq9jErHV1Ze9FLtDmY7sDbwGNcxxRnuV4dx8Cse";

test("an account with no code is not a proven Shade interface", async () => {
  const report = await auditNoCode(fixture.codeHash, () => viewError(fixture.callFunctionError));
  assertNoContract(report);
  for (const name of ["get_contract_info", "get_agents", "get_approved_measurements", "get_agent"]) {
    const item = probe(report, name);
    assert.equal(item.outcome, "absent");
    assert.equal(item.detail, "CodeDoesNotExist");
  }
  const removed = finding(report, "contract.remove");
  assert.equal(removed.ladder, "NOT_PROVEN");
  assert.doesNotMatch(removed.plainEnglish, /MethodNotFound/);
});

test("an all-ones code hash does not count a panic or a successful view as a present method", async () => {
  const panicked = await auditNoCode(fixture.codeHash, () => viewError(PANIC));
  assertNoContract(panicked);

  const answered = await auditNoCode(fixture.codeHash, (method) => {
    if (method === "get_contract_info") return viewOk({ requires_tee: true, owner_id: "ironshield.near" });
    if (method === "get_agents" || method === "get_approved_measurements") return viewOk([]);
    return viewError("wasm execution failed with error: MethodResolveError(MethodNotFound)");
  });
  assertNoContract(answered);

  const blank = await auditNoCode("   ", () => viewError(PANIC));
  assertNoContract(blank);
});

test("CodeDoesNotExist on a non-empty code hash still does not count the method as present", async () => {
  const report = await auditAccount("shade-agent.testnet", options(DEPLOYED_HASH, () => viewError(fixture.callFunctionError)));
  assertNoContract(report);
});

test("a guest panic on deployed code still counts the method as present", async () => {
  const report = await auditAccount(
    "shade-agent.testnet",
    options(DEPLOYED_HASH, (method) => {
      if (method === "get_contract_info" || method === "get_agents" || method === "get_approved_measurements") {
        return viewError(PANIC);
      }
      if (method === "get_approved_ppids") return viewError(fixture.callFunctionError);
      return viewError("wasm execution failed with error: MethodResolveError(MethodNotFound)");
    }),
  );
  assert.equal(report.shade, "shade-v2");
  assert.equal(finding(report, "shade.interface").ladder, "PROVEN");
  assert.equal(probe(report, "get_contract_info").outcome, "present");
  assert.equal(probe(report, "get_agents").outcome, "present");
  assert.equal(probe(report, "get_approved_measurements").outcome, "present");
  assert.equal(probe(report, "get_approved_ppids").outcome, "absent");
  assert.equal(probe(report, "get_approved_ppids").detail, "CodeDoesNotExist");
  assert.doesNotMatch(finding(report, "shade.interface").plainEnglish, /No contract code is deployed/);

  const named = await auditAccount(
    "shade-agent.testnet",
    options(DEPLOYED_HASH, (method) => {
      if (method === "get_contract_info" || method === "get_agents" || method === "get_approved_measurements") {
        return viewError(PANIC_NAMES_CODE);
      }
      return viewError("wasm execution failed with error: MethodResolveError(MethodNotFound)");
    }),
  );
  assert.equal(named.shade, "shade-v2");
  assert.equal(probe(named, "get_agents").outcome, "present");
});

test("CodeDoesNotExist is not MethodNotFound, so it does not select an interface that needs a method to be missing", async () => {
  const report = await auditAccount(
    "shade-agent.testnet",
    options(DEPLOYED_HASH, (method) => {
      if (method === "get_agent") return viewError(PANIC);
      if (method === "get_contract_info") return viewError(fixture.callFunctionError);
      return viewError("wasm execution failed with error: MethodResolveError(MethodNotFound)");
    }),
  );
  assert.equal(report.shade, "unknown");
  assert.equal(probe(report, "get_agent").outcome, "present");
  assert.equal(probe(report, "get_contract_info").detail, "CodeDoesNotExist");
  assert.equal(finding(report, "shade.interface").ladder, "NOT_PROVEN");
});

test("an empty code hash with a global contract can still have methods", async () => {
  const report = await auditAccount(
    "ac-sandbox.nova-shade-agent.testnet",
    options(
      fixture.codeHash,
      (method) => {
        if (method === "get_agent") return viewOk({ codehash: "aa" });
        return viewError("wasm execution failed with error: MethodResolveError(MethodNotFound)");
      },
      { globalContractHash: "GMXJXnVK9vYd7CSYPtbA56rPau2h5J4YjsSsCfegGi4G" },
    ),
  );
  assert.equal(report.shade, "shade-v1");
  assert.equal(probe(report, "get_agent").outcome, "present");
  assert.equal(probe(report, "get_contract_info").outcome, "absent");
  assert.equal(probe(report, "get_contract_info").detail, "MethodNotFound");
  assert.equal(finding(report, "shade.interface").ladder, "PROVEN");
  assert.doesNotMatch(finding(report, "shade.interface").plainEnglish, /No contract code is deployed/);
});

function assertNoContract(report: Report): void {
  assert.equal(report.shade, "unknown");
  assert.deepEqual(report.methodProbes?.filter((item) => item.outcome === "present") ?? [], []);
  const shade = finding(report, "shade.interface");
  assert.equal(shade.ladder, "NOT_PROVEN");
  assert.equal(shade.plainEnglish, "No contract code is deployed on this account.");
  assert.equal(shade.title, "Contract interface was not recognised");
}

async function auditNoCode(codeHash: string, handler: (method: string) => Response): Promise<Report> {
  return auditAccount(fixture.accountId, options(codeHash, handler, { network: "mainnet" }));
}

function options(
  codeHash: string,
  handler: (method: string) => Response,
  extra: { network?: "mainnet" | "testnet"; globalContractHash?: string } = {},
): Parameters<typeof auditAccount>[1] {
  return {
    network: extra.network ?? "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { params?: { request_type?: string; method_name?: string } };
      const params = body.params ?? {};
      if (params.request_type === "view_account") {
        return json({
          result: {
            code_hash: codeHash,
            global_contract_hash: extra.globalContractHash ?? null,
            storage_usage: 182,
          },
        });
      }
      if (params.request_type === "view_access_key_list") return json({ result: { keys: [] } });
      if (params.request_type === "call_function") return handler(params.method_name ?? "");
      throw new Error(`unexpected rpc ${params.request_type ?? "none"}`);
    },
  };
}

function probe(report: Report, name: string) {
  const item = report.methodProbes?.find((entry) => entry.name === name);
  assert.ok(item, name);
  return item;
}

function finding(report: Report, id: string) {
  const item = report.findings.find((entry) => entry.id === id);
  assert.ok(item, id);
  return item;
}

function viewOk(value: unknown): Response {
  return json({ result: { result: Array.from(Buffer.from(JSON.stringify(value), "utf8")) } });
}

function viewError(error: string): Response {
  return json({ result: { result: [], error, logs: [] } });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
