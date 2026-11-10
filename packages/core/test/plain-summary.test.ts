import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditValue } from "../src/audit.js";
import { buildPlainSummary } from "../src/plain-summary.js";
import { buildReport, formatReport } from "../src/report.js";
import type { EvidenceBundle, Finding, Ladder, PlainSummary } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures/votron-registration.json"), "utf8"));
const FROZEN = new Date("2026-11-05T12:00:00.000Z");

const FULL_ACCESS =
  "The owner of this agent can still change its code at any time, so its secure-enclave promise does not fully hold.";
const NO_QUOTE = "This agent has not published proof that it runs inside a secure enclave.";

test("a votron-like report leads with the full-access key and does not call the result proven", async () => {
  const report = await auditValue(fixture, { now: FROZEN, label: "votron-fixture" });
  const keys = report.findings.find((finding) => finding.id === "access.keys");
  assert.equal(keys?.ladder, "RISKY");
  assert.match(keys?.plainEnglish ?? "", /Full-access/);
  const summary = report.plainSummary;
  assert.equal(summary.text.startsWith(FULL_ACCESS), true);
  assert.equal(sentenceCount(summary.text) <= 2, true);
  assert.doesNotMatch(summary.text, /has not published proof/);
  assertNoPass(summary);
  const text = formatReport(report);
  assert.match(text, new RegExp(`^${escapeRegExp(FULL_ACCESS)}`));
  assert.match(text, /What to do: Do not treat this agent as locked down\./);
  assert.ok(text.indexOf(FULL_ACCESS) < text.indexOf("Glassbox report"));
});

test("a no-quote mainnet account names the missing enclave proof and still leads with a risky key", () => {
  const report = buildReport(bundle({
    target: "ironshield.near",
    network: "mainnet",
    shade: "shade-v2",
    shadeDetail: "Shade v2 interface. No registration quote was supplied.",
    methodsPresent: ["get_contract_info", "get_agents", "get_approved_measurements"],
    registration: null,
    accessKeys: [
      {
        public_key: "ed25519:owner",
        access_key: { permission: "FullAccess" },
      },
    ],
    historySource: "nearblocks",
    inputOrigin: "chain",
  }), { now: FROZEN });
  const quote = report.findings.find((finding) => finding.id === "tdx.registration");
  assert.equal(quote?.ladder, "NOT_PROVEN");
  assert.match(quote?.title ?? "", /No registration quote was loaded/);
  const summary = report.plainSummary;
  assert.equal(summary.text.startsWith(FULL_ACCESS), true);
  assert.match(summary.text, new RegExp(escapeRegExp(NO_QUOTE)));
  assert.ok(summary.text.indexOf(FULL_ACCESS) < summary.text.indexOf(NO_QUOTE));
  assert.equal(sentenceCount(summary.text) <= 2, true);
  assertNoPass(summary);
  assert.match(summary.whatToDo, /locked down/);
  assert.match(formatReport(report), new RegExp(`^${escapeRegExp(FULL_ACCESS)}`));
});

test("an all-not-proven report does not read as a pass", () => {
  const report = buildReport(bundle({
    target: "missing.near",
    network: "mainnet",
    shade: "unknown",
    shadeDetail: "No known interface.",
    methodsPresent: [],
    registration: null,
    historySource: "nearblocks",
    inputOrigin: "chain",
  }), { now: FROZEN });
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every((finding) => finding.ladder === "NOT_PROVEN"));
  const summary = report.plainSummary;
  assert.equal(sentenceCount(summary.text) <= 2, true);
  assertNoPass(summary);
  assert.match(`${summary.text} ${summary.whatToDo}`, /not published proof|did not prove|missing proof|not a pass|could not/i);
  assert.match(summary.whatToDo, /Do not treat missing proof as a pass/);
  assert.doesNotMatch(summary.text, /came back proven/);
});

test("a hypothetical all-proven report may say the checks came back proven, and one gap removes that claim", () => {
  const proven = [
    row("tdx.signature", "PROVEN", "Quote signature verified"),
    row("tdx.registration", "PROVEN", "TCB status at registration is UpToDate"),
    row("access.keys", "PROVEN", "Access keys are limited function-call keys", "Every access key is a function-call key with a named method."),
    row("dstack.range", "PROVEN", "Registered configuration is a known fixed image"),
  ];
  const summary = buildPlainSummary(proven);
  assert.equal(summary.text, "Every check in this report came back proven.");
  assert.equal(sentenceCount(summary.text), 1);
  assert.equal(summary.whatToDo, "Read the findings if you want the detail.");
  assert.doesNotMatch(`${summary.text} ${summary.whatToDo}`, /\bsafe\b/i);
  assert.doesNotMatch(summary.whatToDo, /not a pass|locked down/);

  const withGap = buildPlainSummary([
    ...proven,
    row("runtime.observed", "NOT_PROVEN", "What the account is executing now was not observed", "Glassbox did not take a live guest quote."),
  ]);
  assert.notEqual(withGap.text, summary.text);
  assertNoPass(withGap);
  assert.match(withGap.whatToDo, /missing proof as a pass/);
});

function assertNoPass(summary: PlainSummary): void {
  const text = `${summary.text} ${summary.whatToDo}`;
  assert.doesNotMatch(text, /\bsafe\b/i);
  assert.doesNotMatch(text, /\bcame back proven\b/i);
  assert.doesNotMatch(text, /\b(is|are|was) proven\b/i);
  assert.doesNotMatch(text, /\bpasses\b/i);
  assert.doesNotMatch(text, /\bfully holds\b/i);
  assert.doesNotMatch(text, /hacked/i);
}

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function row(id: string, ladder: Ladder, title: string, plainEnglish = title): Finding {
  return {
    id,
    ladder,
    title,
    plainEnglish,
    inference: false,
    evidence: [],
    provenance: {
      evidenceSource: "computed",
      observationKind: "computed",
      liveChain: false,
      label: "Synthetic finding for the plain summary.",
    },
  };
}

function bundle(patch: Partial<EvidenceBundle> & Pick<EvidenceBundle, "target" | "network" | "shade">): EvidenceBundle {
  return {
    shadeDetail: "fixture",
    methodsPresent: [],
    registration: null,
    compose: null,
    rpcEndpoints: [],
    generatedAt: FROZEN.toISOString(),
    ...patch,
  };
}
