import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Report } from "core";
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

test("diff compares two files and --anchor does not send a transaction", async () => {
  const pinned = join(here, "../../../fixtures/compose/pinned.json");
  const loose = join(here, "../../../fixtures/compose/loose.json");
  const diff = await run(["diff", pinned, loose]);
  assert.equal(diff.code, 0, diff.stderr);
  assert.match(diff.stdout, /Glassbox diff/);
  assert.match(diff.stdout, /public_logs: false → true/);
  assert.doesNotMatch(diff.stdout, /supersecretvalue99/);
  assert.doesNotMatch(diff.stdout, /hacked/i);
  assert.doesNotMatch(diff.stdout, /currently running/i);
  const left = join(here, "../../core/test/fixtures/diff-left.json");
  const right = join(here, "../../core/test/fixtures/diff-right.json");
  const measured = await run(["diff", left, right, "--json"]);
  assert.equal(measured.code, 0, measured.stderr);
  const parsed = JSON.parse(measured.stdout) as { kind: string; measurements: string[] };
  assert.equal(parsed.kind, "diff");
  assert.ok(parsed.measurements.some((line) => line.startsWith("os_image_hash:")));
  const anchored = await run([fixture, "--anchor"]);
  assert.equal(anchored.code, 0, anchored.stderr);
  assert.match(anchored.stdout, /Threat model/);
  assert.match(anchored.stdout, /tee\.fail/i);
  assert.match(anchored.stderr, /does not send a transaction/);
  assert.match(anchored.stderr, /does not spend gas/);
  assert.doesNotMatch(anchored.stderr, /broadcast/);
  const json = await run([fixture, "--anchor", "--json"]);
  const report = JSON.parse(json.stdout) as { threatModel: string; anchor: { status: string; intent: boolean } };
  assert.match(report.threatModel, /DDR5/);
  assert.equal(report.anchor.status, "skipped");
  assert.equal(report.anchor.intent, true);
});

test("diff reads saved JSON reports and separates a TCB baseline move from the same registration", async () => {
  const audited = await run([fixture, "--json"]);
  assert.equal(audited.code, 0, audited.stderr);
  const base = JSON.parse(audited.stdout) as Report;
  const t1 = savedTcbSnapshot(base, "PROVEN", "Registered configuration's TCB is now UpToDate", "2026-11-05T10:00:00.000Z");
  const t2 = savedTcbSnapshot(base, "RISKY", "Registered configuration's TCB is now OutOfDate", "2026-11-06T10:00:00.000Z");
  const dir = mkdtempSync(join(tmpdir(), "glassbox-tcb-diff-"));
  const t1Path = join(dir, "t1.json");
  const t2Path = join(dir, "t2.json");
  writeFileSync(t1Path, `${JSON.stringify(t1)}\n`);
  writeFileSync(t2Path, `${JSON.stringify(t2)}\n`);

  const text = await run(["diff", t1Path, t2Path]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /Collateral freshness \(TCB baseline\)/);
  assert.match(text.stdout, /OutOfDate/);
  assert.match(text.stdout, /registration transaction is unchanged/);

  const json = await run(["diff", t1Path, t2Path, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const diff = JSON.parse(json.stdout) as {
    registration: { identity: string };
    collateralFreshness: { changed: boolean; attribution: string; left: string; right: string };
  };
  assert.equal(diff.registration.identity, "same");
  assert.equal(diff.collateralFreshness.changed, true);
  assert.equal(diff.collateralFreshness.attribution, "same-registration");
  assert.match(diff.collateralFreshness.left, /UpToDate/);
  assert.match(diff.collateralFreshness.right, /OutOfDate/);

  const oldT1 = JSON.parse(JSON.stringify(t1)) as Record<string, unknown>;
  const oldT2 = JSON.parse(JSON.stringify(t2)) as Record<string, unknown>;
  delete (oldT1.facts as Record<string, unknown>).appComposeSha256;
  delete (oldT2.facts as Record<string, unknown>).appComposeSha256;
  const oldT1Path = join(dir, "old-t1.json");
  const oldT2Path = join(dir, "old-t2.json");
  writeFileSync(oldT1Path, `${JSON.stringify(oldT1)}\n`);
  writeFileSync(oldT2Path, `${JSON.stringify(oldT2)}\n`);
  const oldDiff = await run(["diff", oldT1Path, oldT2Path, "--json"]);
  assert.equal(oldDiff.code, 0, oldDiff.stderr);
  assert.equal(JSON.parse(oldDiff.stdout).registration.identity, "same");
});

function savedTcbSnapshot(
  report: Report,
  ladder: "PROVEN" | "NOT_PROVEN" | "RISKY",
  title: string,
  checkedAt: string,
): Report {
  const findings = report.findings.map((finding) =>
    finding.id === "tdx.fresh" ? { ...finding, ladder, title, lane: "collateral-freshness" as const } : finding,
  );
  const summary = {
    proven: findings.filter((finding) => finding.ladder === "PROVEN").length,
    notProven: findings.filter((finding) => finding.ladder === "NOT_PROVEN").length,
    risky: findings.filter((finding) => finding.ladder === "RISKY").length,
  };
  const overall = summary.risky > 0 ? "RISKY" : summary.notProven > 0 ? "NOT_PROVEN" : "PROVEN";
  return {
    ...report,
    generatedAt: checkedAt,
    inputs: {
      ...report.inputs,
      collateralFetchedAt: checkedAt,
      freshCollateralSource: "https://pccs.phala.network",
    },
    findings,
    summary,
    overall,
    overallPlainEnglish: `Highest rung on this ladder is ${overall.replace("_", " ")} (${summary.risky} risky, ${summary.notProven} not proven, ${summary.proven} proven). That is the strongest concern already listed. It is not a separate check.`,
  };
}

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
