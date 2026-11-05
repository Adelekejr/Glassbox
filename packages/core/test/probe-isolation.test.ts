import assert from "node:assert/strict";
import test from "node:test";
import { auditAccount } from "../src/audit.js";
import { isLiveChainProof } from "../src/provenance.js";
import type { Report } from "../src/types.js";

const FROZEN = new Date("2026-11-04T12:00:00.000Z");

test("one failed view probe does not abort the audit or count as method absent", async () => {
  const report = await auditAccount("shade-agent.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => {
        throw new Error("socket hang up");
      },
      get_agent: () => viewOk({ codehash: "aa" }),
    }),
  });
  assert.equal(report.shade, "unknown");
  const failed = probe(report, "get_contract_info");
  assert.equal(failed.outcome, "unavailable");
  assert.match(failed.detail ?? "", /not MethodNotFound/);
  const answered = probe(report, "get_agent");
  assert.equal(answered.outcome, "present");
  const shade = finding(report, "shade.interface");
  assert.equal(shade.ladder, "NOT_PROVEN");
  assert.equal(shade.provenance.observationKind, "unavailable");
  assert.equal(isLiveChainProof(shade), false);
  assert.match(shade.plainEnglish, /not MethodNotFound/);
  assert.match(shade.plainEnglish, /Methods that answered: get_agent/);
});

test("a failed get_agent probe leaves a Shade v2 classification from the probes that answered", async () => {
  const report = await auditAccount("shade-agent.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_agent: () => {
        throw new Error("timeout");
      },
      get_contract_info: () => viewOk({ requires_tee: true, owner_id: "shade-agent.testnet" }),
      get_approved_measurements: () => viewOk([]),
      get_agents: () => viewOk([]),
    }),
  });
  assert.equal(report.shade, "shade-v2");
  assert.equal(probe(report, "get_agent").outcome, "unavailable");
  assert.equal(probe(report, "get_contract_info").outcome, "present");
  const shade = finding(report, "shade.interface");
  assert.equal(shade.ladder, "PROVEN");
  assert.equal(isLiveChainProof(shade), true);
  assert.match(shade.plainEnglish, /get_agent/);
  assert.match(shade.plainEnglish, /not treated as absent/);
});

test("a failed measurements probe stays NOT_PROVEN and is not an empty list", async () => {
  const report = await auditAccount("shade-agent.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => viewOk({ requires_tee: true, owner_id: "shade-agent.testnet" }),
      get_approved_measurements: () => {
        throw new Error("connection reset");
      },
      get_agents: () => viewOk([]),
    }),
  });
  assert.equal(report.shade, "shade-v2");
  assert.equal(probe(report, "get_approved_measurements").outcome, "unavailable");
  const measurements = finding(report, "measurements.approved");
  assert.equal(measurements.ladder, "NOT_PROVEN");
  assert.equal(measurements.provenance.observationKind, "unavailable");
  assert.equal(isLiveChainProof(measurements), false);
  assert.match(measurements.plainEnglish, /not MethodNotFound/);
  assert.match(measurements.plainEnglish, /not an empty approved list/);
});

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

function rpcFetch(handlers: Record<string, () => Response>): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { params?: { request_type?: string; method_name?: string } };
    const params = body.params ?? {};
    if (params.request_type === "view_account") {
      return json({ result: { code_hash: "abc", storage_usage: 1 } });
    }
    if (params.request_type === "view_access_key_list") {
      return json({ result: { keys: [] } });
    }
    if (params.request_type === "call_function") {
      const method = params.method_name ?? "";
      const handler = handlers[method];
      if (!handler) return methodNotFound();
      return handler();
    }
    throw new Error(`unexpected rpc ${params.request_type ?? "none"}`);
  };
}

function viewOk(value: unknown): Response {
  return json({ result: { result: Array.from(Buffer.from(JSON.stringify(value), "utf8")) } });
}

function methodNotFound(): Response {
  return json({
    result: {
      result: [],
      error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
    },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
