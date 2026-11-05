import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_INDEX_PATHS,
  INDEX_SEEDS,
  buildAgentIndex,
  buildAgentIndexFromFiles,
  crawlAgentIndex,
  renderIndexHtml,
} from "../src/agent-index.js";
import { auditValue } from "../src/audit.js";
import type { Report } from "../src/types.js";

const SECRET = "supersecretvalue99";

test("the seed list names the known testnet and mainnet accounts", () => {
  const ids = INDEX_SEEDS.map((seed) => seed.accountId);
  for (const id of [
    "ac-sandbox.votron.testnet",
    "ac-sandbox.ajitesh-1.testnet",
    "ac-sandbox.nova-shade-agent.testnet",
    "ac-sandbox.leo-leo-leo.testnet",
    "ac-proxy.leo-leo-leo.testnet",
    "reflect-adam-mainnet-agent-contract.near",
    "ironshield.near",
  ]) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(INDEX_SEEDS.find((seed) => seed.accountId === "ironshield.near")?.network, "mainnet");
  assert.equal(
    INDEX_SEEDS.find((seed) => seed.accountId === "ac-sandbox.votron.testnet")?.network,
    "testnet",
  );
});

test("fixture index counts the strip and keeps secret values out", async () => {
  const index = await buildAgentIndexFromFiles([...FIXTURE_INDEX_PATHS], new Date("2026-11-04T12:00:00.000Z"));
  assert.equal(index.source, "fixture");
  assert.equal(index.totals.scanned, 3);
  assert.match(
    index.totals.sentence,
    /^\d+ agents scanned · \d+ proven · \d+ match a vulnerable configuration · \d+ not proven$/,
  );
  assert.ok(index.totals.vulnerableConfiguration >= 1);
  assert.equal(index.totals.proven + index.totals.vulnerableConfiguration + index.totals.notProven, index.totals.scanned);
  const text = `${JSON.stringify(index)}\n${renderIndexHtml(index)}`;
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);
  assert.match(text, /matches a vulnerable configuration/);
  assert.equal(index.attribution.length, 0);
  const votron = index.rows.find((row) => row.accountId.includes("votron"));
  assert.equal(votron?.bucket, "vulnerable-configuration");
  assert.equal(votron?.configurationClass, "matches a vulnerable configuration");
});

test("a live crawl that cannot reach RPC still returns rows and does not invent NearBlocks attribution", async () => {
  const index = await crawlAgentIndex({
    seeds: [{ accountId: "missing.testnet", network: "testnet" }],
    rpcEndpoints: ["https://rpc.example.test"],
    rpcIntervalMs: 0,
    nearblocksIntervalMs: 0,
    fetch: async () => new Response("no", { status: 503 }),
  });
  assert.equal(index.source, "live");
  assert.equal(index.rows.length, 1);
  assert.equal(index.rows[0]?.bucket, "not-proven");
  assert.equal(index.attribution.length, 0);
  assert.match(index.totals.sentence, /1 agents scanned/);
});

test("NearBlocks attribution is kept when a report already has it", async () => {
  const report = await auditValue({ public_logs: false }, { label: "sample.near" });
  report.attribution = ["Powered by Nearblocks.io APIs."];
  const index = buildAgentIndex([report as Report], "live", "2026-11-04T12:00:00.000Z");
  assert.deepEqual(index.attribution, ["Powered by Nearblocks.io APIs."]);
  assert.match(renderIndexHtml(index), /Powered by Nearblocks.io APIs\./);
});
