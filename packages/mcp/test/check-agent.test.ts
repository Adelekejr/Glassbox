import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CHECK_AGENT_DESCRIPTION, checkAgent } from "../src/check.js";
import { resetCheckLimiter } from "../src/limit.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "../../core/test/fixtures/votron-registration.json");

test("check_agent returns the ladder for pasted registration JSON", async () => {
  resetCheckLimiter();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", join(here, "../src/main.ts")],
    cwd: join(here, ".."),
    stderr: "pipe",
  });
  const client = new Client({ name: "glassbox-test", version: "0.2.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find((item) => item.name === "check_agent");
    assert.ok(tool);
    const described = JSON.stringify(tool);
    assert.match(described, /Read-only audit/);
    assert.match(described, /Local files are not read|not accepted/);
    assert.doesNotMatch(described, /file path is accepted/i);
    assert.doesNotMatch(described, /ignore previous|system prompt|you must|exfiltrate/i);
    assert.equal(tool.description, CHECK_AGENT_DESCRIPTION);
    const properties = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
    assert.deepEqual(properties.sort(), ["network", "target"]);
    const result = await client.callTool({
      name: "check_agent",
      arguments: { target: readFileSync(fixture, "utf8") },
    });
    const text = textOf(result.content);
    const parsed = JSON.parse(text) as {
      overall: string;
      summary: string;
      plainSummary: { text: string; whatToDo: string };
      report: {
        shade: string;
        verifier: { version: string; qeIdentity: string };
        findings: {
          id: string;
          ladder: string;
          plainEnglish: string;
          provenance?: { liveChain?: boolean; observationKind?: string; label?: string };
        }[];
      };
    };
    assert.equal(parsed.overall, "RISKY");
    assert.match(parsed.summary, /Highest rung/);
    assert.match(parsed.plainSummary.text, /change its code/);
    assert.match(parsed.plainSummary.whatToDo, /locked down/);
    assert.doesNotMatch(parsed.plainSummary.text, /\bsafe\b/i);
    assert.equal(parsed.report.shade, "shade-v1");
    assert.equal(parsed.report.verifier.version, "0.7.1");
    assert.equal(parsed.report.verifier.qeIdentity, "mandatory");
    const signature = parsed.report.findings.find((finding) => finding.id === "tdx.signature");
    assert.equal(signature?.ladder, "PROVEN");
    assert.equal(signature?.provenance?.liveChain, false);
    assert.equal(signature?.provenance?.observationKind, "computed");
    assert.match(signature?.provenance?.label ?? "", /supplied quote bytes/i);
    assert.ok(parsed.report.findings.every((finding) => finding.provenance?.liveChain !== true));
    assert.ok(parsed.report.findings.some((finding) => finding.id === "tdx.qe_identity" && finding.ladder === "PROVEN"));
    assert.ok(parsed.report.findings.some((finding) => finding.id === "tdx.registration" && finding.ladder === "PROVEN"));
    assert.ok(parsed.report.findings.some((finding) => finding.id === "compose.plaintext_secrets"));
    assert.doesNotMatch(text, /hacked/i);
    assert.doesNotMatch(text, /currently running/i);
  } finally {
    await client.close();
  }
});

test("check_agent does not read local files, traversals, or symlinks", async () => {
  resetCheckLimiter();
  const root = mkdtempSync(join(tmpdir(), "glassbox-mcp-"));
  const outside = mkdtempSync(join(tmpdir(), "glassbox-mcp-outside-"));
  const canary = "SUPERSECRET-CANARY-glassbox";
  const secret = join(outside, "secret.json");
  writeFileSync(secret, JSON.stringify({ marker: canary, code_hash: "abc" }));
  const link = join(root, "link.json");
  symlinkSync(secret, link);
  const traversal = join(root, "..", "secret.json");
  for (const target of [secret, link, traversal, "../secret.json", "nested/../../secret.json"]) {
    await assert.rejects(
      () => checkAgent({ target }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /not accepted/i);
        assert.doesNotMatch(message, new RegExp(canary));
        return true;
      },
    );
  }
});

test("check_agent refuses a local file that is not JSON", async () => {
  resetCheckLimiter();
  const wasm = join(here, "../../core/test/fixtures/shade-contract-template.wasm");
  await assert.rejects(() => checkAgent({ target: wasm }), /json/i);
});

test("check_agent does not read cwd package.json", async () => {
  resetCheckLimiter();
  const root = mkdtempSync(join(tmpdir(), "glassbox-mcp-cwd-"));
  const canary = "SUPERSECRET-PACKAGE-JSON-CANARY";
  const file = join(root, "package.json");
  writeFileSync(
    file,
    JSON.stringify({ name: "glassbox-mcp", private: true, description: canary, marker: canary }),
  );
  const previous = process.cwd();
  const originalFetch = globalThis.fetch;
  const queries: { url: string; accountId?: string; requestType?: string }[] = [];
  let mode: "missing" | "account" = "missing";
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = readRpcBody(init);
    queries.push({ url, accountId: parsed?.accountId, requestType: parsed?.requestType });
    if (mode === "missing") {
      return rpcJson({
        error: { cause: { name: "UNKNOWN_ACCOUNT" }, message: "does not exist" },
      });
    }
    if (parsed?.requestType === "view_account") {
      return rpcJson({ result: { code_hash: "abc", storage_usage: 1 } });
    }
    if (parsed?.requestType === "view_access_key_list") {
      return rpcJson({ result: { keys: [] } });
    }
    if (parsed?.requestType === "call_function") {
      return rpcJson({
        result: {
          result: [],
          error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
        },
      });
    }
    throw new Error(`unexpected rpc ${parsed?.requestType ?? "none"}`);
  }) as typeof fetch;

  try {
    process.chdir(root);
    try {
      await assert.rejects(
        () => checkAgent({ target: "package.json" }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /No NEAR account "package\.json"/);
          assert.doesNotMatch(message, new RegExp(canary));
          assert.doesNotMatch(message, /glassbox-mcp/);
          return true;
        },
      );
    } finally {
      process.chdir(previous);
    }
    assert.ok(queries.length >= 1);
    assert.ok(queries.every((query) => query.accountId === "package.json"));
    assert.ok(queries.every((query) => query.requestType === "view_account"));
    assert.match(readFileSync(file, "utf8"), new RegExp(canary));

    queries.length = 0;
    resetCheckLimiter();
    const pasted = await checkAgent({
      target: JSON.stringify({ name: "pasted-probe", public_logs: false }),
    });
    assert.ok(pasted.overall === "RISKY" || pasted.overall === "NOT_PROVEN" || pasted.overall === "PROVEN");
    assert.equal(pasted.report.target, "pasted-json");
    assert.equal(pasted.report.network, "offline");
    assert.equal(queries.length, 0);
    assert.doesNotMatch(JSON.stringify(pasted), new RegExp(canary));

    queries.length = 0;
    mode = "account";
    resetCheckLimiter();
    const account = await checkAgent(
      { target: "ac-sandbox.votron.testnet", network: "testnet" },
      { skipHistory: true, skipMpc: true, skipFreshCollateral: true, rpcIntervalMs: 0 },
    );
    assert.equal(account.report.target, "ac-sandbox.votron.testnet");
    assert.equal(account.report.network, "testnet");
    assert.equal(account.report.facts.contractCodeHash, "abc");
    assert.ok((account.report.methodProbes?.length ?? 0) > 0);
    assert.ok(queries.length > 0);
    assert.ok(queries.every((query) => query.accountId === "ac-sandbox.votron.testnet"));
    assert.doesNotMatch(JSON.stringify(account), new RegExp(canary));
  } finally {
    process.chdir(previous);
    globalThis.fetch = originalFetch;
  }
});

test("check_agent refuses URLs, bad account ids, and a caller PCCS URL", async () => {
  resetCheckLimiter();
  await assert.rejects(() => checkAgent({ target: "https://pccs.evil.example/agent" }), /URL/);
  await assert.rejects(() => checkAgent({ target: "not an account" }), /account id/i);
  await assert.rejects(
    () => checkAgent({ target: "ac-sandbox.votron.testnet", pccsUrl: "https://evil.example" }),
    /not accepted/,
  );
});

test("check_agent rate-limits a burst", async () => {
  resetCheckLimiter();
  const body = JSON.stringify({ name: "rate-limit-probe", public_logs: false });
  for (let index = 0; index < 6; index += 1) {
    const result = await checkAgent({ target: body });
    assert.ok(result.overall === "RISKY" || result.overall === "NOT_PROVEN" || result.overall === "PROVEN");
  }
  await assert.rejects(() => checkAgent({ target: body }), /Too many/);
  resetCheckLimiter();
});

function readRpcBody(init?: RequestInit): { accountId?: string; requestType?: string } | null {
  if (!init?.body) return null;
  const body = JSON.parse(String(init.body)) as {
    params?: { account_id?: string; request_type?: string };
  };
  return { accountId: body.params?.account_id, requestType: body.params?.request_type };
}

function rpcJson(body: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "glassbox", ...((body ?? {}) as object) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : ""))
    .join("\n");
}
