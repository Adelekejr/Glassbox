import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { checkAgent } from "../src/check.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "../../core/test/fixtures/votron-registration.json");

test("check_agent returns the ladder for a pasted registration file", async () => {
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
    assert.ok(listed.tools.some((tool) => tool.name === "check_agent"));
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
  const wasm = join(here, "../../core/test/fixtures/shade-contract-template.wasm");
  await assert.rejects(() => checkAgent({ target: wasm }), /json/i);
});

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : ""))
    .join("\n");
}
