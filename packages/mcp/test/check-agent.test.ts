import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CHECK_AGENT_DESCRIPTION, checkAgent } from "../src/check.js";
import { resetCheckLimiter } from "../src/limit.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "../../core/test/fixtures/votron-registration.json");

test("check_agent returns the ladder for a pasted registration file", async () => {
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
    assert.doesNotMatch(described, /ignore previous|system prompt|you must|exfiltrate/i);
    assert.equal(tool.description, CHECK_AGENT_DESCRIPTION);
    const properties = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
    assert.deepEqual(properties.sort(), ["network", "target"]);
    const result = await client.callTool({ name: "check_agent", arguments: { target: fixture } });
    const text = textOf(result.content);
    const parsed = JSON.parse(text) as {
      overall: string;
      summary: string;
      report: {
        shade: string;
        verifier: { version: string; qeIdentity: string };
        findings: { id: string; ladder: string; plainEnglish: string }[];
      };
    };
    assert.equal(parsed.overall, "RISKY");
    assert.match(parsed.summary, /Highest rung/);
    assert.equal(parsed.report.shade, "shade-v1");
    assert.equal(parsed.report.verifier.version, "0.7.1");
    assert.equal(parsed.report.verifier.qeIdentity, "mandatory");
    assert.ok(parsed.report.findings.some((finding) => finding.id === "tdx.signature" && finding.ladder === "PROVEN"));
    assert.ok(parsed.report.findings.some((finding) => finding.id === "tdx.qe_identity" && finding.ladder === "PROVEN"));
    assert.ok(parsed.report.findings.some((finding) => finding.id === "tdx.registration" && finding.ladder === "PROVEN"));
    assert.ok(parsed.report.findings.some((finding) => finding.id === "compose.plaintext_secrets"));
    assert.doesNotMatch(text, /hacked/i);
    assert.doesNotMatch(text, /currently running/i);
  } finally {
    await client.close();
  }
});

test("check_agent refuses a local file that is not JSON", async () => {
  resetCheckLimiter();
  const wasm = join(here, "../../core/test/fixtures/shade-contract-template.wasm");
  await assert.rejects(() => checkAgent({ target: wasm }), /json/i);
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

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : ""))
    .join("\n");
}
