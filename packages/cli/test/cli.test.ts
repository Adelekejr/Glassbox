import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, run } from "../src/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "../../core/test/fixtures/votron-registration.json");
const pinned = join(here, "../../../fixtures/compose/pinned.json");
const loose = join(here, "../../../fixtures/compose/loose.json");

test("parseArgs accepts an account, --json, and --network", () => {
  const parsed = parseArgs(["ac-sandbox.votron.testnet", "--json", "--network", "testnet"]);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.target, "ac-sandbox.votron.testnet");
  assert.equal(parsed.json, true);
  assert.equal(parsed.network, "testnet");
  const bad = parseArgs(["--network", "betanet"]);
  assert.ok("error" in bad);
  const pccs = parseArgs(["ac-sandbox.votron.testnet", "--pccs", "https://evil.example"]);
  assert.ok("error" in pccs);
  if ("error" in pccs) assert.match(pccs.error, /not accepted/);
});

test("a capture file prints a report without calling the network", async () => {
  const human = await run([fixture]);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /Glassbox report/);
  assert.match(human.stdout, /ac-sandbox\.votron\.testnet/);
  assert.match(human.stdout, /RISKY/);
  assert.match(human.stdout, /PROVEN/);
  assert.match(human.stdout, /NOT PROVEN/);
  assert.doesNotMatch(human.stdout, /hacked/i);
  assert.doesNotMatch(human.stdout, /currently running/i);
  const json = await run([fixture, "--json"]);
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout) as { tool: string; summary: { risky: number } };
  assert.equal(report.tool, "glassbox");
  assert.ok(report.summary.risky >= 1);
  assert.equal((report as { inputs?: { contract?: string } }).inputs?.contract, "ac-sandbox.votron.testnet");
});

test("a signed report file verifies offline and --json stays the report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glassbox-cli-"));
  const previous = process.env.GLASSBOX_SIGNING_KEY;
  process.env.GLASSBOX_SIGNING_KEY = join(dir, "report-signing-key.pem");
  const out = join(dir, "report.json");
  try {
    const signed = await run([fixture, "--json", "--sign", "--out", out]);
    assert.equal(signed.code, 0, signed.stderr);
    const stdout = JSON.parse(signed.stdout) as { tool: string; findings: unknown[] };
    assert.equal(stdout.tool, "glassbox");
    assert.ok(Array.isArray(stdout.findings));
    assert.doesNotMatch(signed.stdout, /glassbox-signed-report/);
    const file = JSON.parse(readFileSync(out, "utf8")) as { format: string; sha256: string };
    assert.equal(file.format, "glassbox-signed-report");
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    const verified = await run(["verify", out, "--offline"]);
    assert.equal(verified.code, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /Hash: matches/);
    assert.match(verified.stdout, /Signature: matches/);
    assert.match(verified.stdout, /not re-fetched/);
    file.sha256 = "ab".repeat(32);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, JSON.stringify(file));
    const broken = await run(["verify", out, "--offline"]);
    assert.equal(broken.code, 1);
  } finally {
    if (previous === undefined) delete process.env.GLASSBOX_SIGNING_KEY;
    else process.env.GLASSBOX_SIGNING_KEY = previous;
  }
});

test("check --fail-on risky passes a pinned compose and fails a loose one", async () => {
  const clean = await run(["check", pinned, "--fail-on", "risky"]);
  assert.equal(clean.code, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /0 risky/);
  const risky = await run(["check", loose, "--fail-on", "risky"]);
  assert.equal(risky.code, 1);
  assert.match(risky.stdout, /risky/);
});

test("index from fixtures does not call the network and hides secret values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glassbox-index-"));
  const jsonPath = join(dir, "proof-strip.json");
  const htmlPath = join(dir, "proof-strip.html");
  const result = await run(["index", "--out", jsonPath, "--html", htmlPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /agents scanned/);
  const text = readFileSync(jsonPath, "utf8") + readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(text, /supersecretvalue99/);
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);
});
