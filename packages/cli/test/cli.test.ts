import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, run } from "../src/run.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../../core/test/fixtures/votron-registration.json");

test("parseArgs accepts an account, --json, and --network", () => {
  const parsed = parseArgs(["ac-sandbox.votron.testnet", "--json", "--network", "testnet"]);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.target, "ac-sandbox.votron.testnet");
  assert.equal(parsed.json, true);
  assert.equal(parsed.network, "testnet");
  const bad = parseArgs(["--network", "betanet"]);
  assert.ok("error" in bad);
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
});
