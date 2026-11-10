import assert from "node:assert/strict";
import test from "node:test";
import { assessDstack } from "../src/checks/dstack.js";
import { assessProvenance } from "../src/checks/provenance.js";
import { digestsEqual, isDigest } from "../src/evidence/digest.js";
import { buildReport } from "../src/report.js";
import type { ApprovedMeasurementRow, EvidenceBundle, Report } from "../src/types.js";

const FROZEN = new Date("2026-11-04T12:00:00.000Z");
const REAL = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const VOTRON = "2a2f4704345359172f31e992188c60c2cbff4c2151dceeabccf472bad8031243";

test("a digest is 64 or 96 hex characters, with an optional 0x prefix", () => {
  assert.equal(isDigest(REAL), true);
  assert.equal(isDigest(OTHER.toUpperCase()), true);
  assert.equal(isDigest(`0x${REAL}`), true);
  assert.equal(isDigest(`  0X${"e".repeat(96)}  `), true);
  assert.equal(isDigest("0".repeat(64)), true);
  assert.equal(isDigest("0".repeat(96)), true);
  assert.equal(isDigest(VOTRON), true);
  assert.equal(digestsEqual(`0x${REAL.toUpperCase()}`, REAL), true);

  assert.equal(isDigest("not-in-a-tee"), false);
  assert.equal(isDigest("NOT-IN-A-TEE"), false);
  assert.equal(isDigest(""), false);
  assert.equal(isDigest("   "), false);
  assert.equal(isDigest("ab"), false);
  assert.equal(isDigest("a".repeat(63)), false);
  assert.equal(isDigest("a".repeat(65)), false);
  assert.equal(isDigest("a".repeat(128)), false);
  assert.equal(isDigest("11111111111111111111111111111111"), false);
  assert.equal(isDigest("2HkUtRxzdaucz8YqQUB24g5Crnn4NiuY2b7fp7SAVFeT"), false);
  assert.equal(digestsEqual("not-in-a-tee", "not-in-a-tee"), false);
});

test("placeholder code hashes on both sides are not proven", () => {
  const report = codehashReport("not-in-a-tee", "not-in-a-tee");
  const finding = codehash(report);
  assert.equal(finding.ladder, "NOT_PROVEN");
  assert.equal(finding.title, "App codehash is not a real hash");
  assert.match(
    finding.plainEnglish,
    /The approved code hash is the placeholder text "not-in-a-tee", not a real hash, so it proves nothing about which code runs\./,
  );
  assert.doesNotMatch(finding.title, /is in approve_codehash history/);
});

test("an empty code hash is not proven", () => {
  const report = codehashReport("", "");
  const finding = codehash(report);
  assert.equal(finding.ladder, "NOT_PROVEN");
  assert.match(finding.plainEnglish, /The code hash is empty, not a real hash, so it proves nothing about which code runs\./);
});

test("a real 64-hex code hash match stays proven, including 0x and case", () => {
  const report = codehashReport(REAL, `0x${REAL.toUpperCase()}`);
  const finding = codehash(report);
  assert.equal(finding.ladder, "PROVEN");
  assert.equal(finding.title, "App codehash is in approve_codehash history");
  assert.match(finding.plainEnglish, new RegExp(REAL));
  assert.match(finding.plainEnglish, /approve_codehash transaction records that same value/);
});

test("a real code hash mismatch stays not proven", () => {
  const report = codehashReport(REAL, OTHER);
  const finding = codehash(report);
  assert.equal(finding.ladder, "NOT_PROVEN");
  assert.equal(finding.title, "App codehash was not seen in approve_codehash history");
  assert.match(finding.plainEnglish, new RegExp(`get_agent returns codehash ${REAL}`));
  assert.match(finding.plainEnglish, /not in the approve_codehash history/);
  assert.match(finding.plainEnglish, /index can be incomplete/);
  assert.doesNotMatch(finding.plainEnglish, /placeholder/);
});

test("a placeholder compose hash, key-provider digest, or os image hash is not a proven match", () => {
  const compose = buildReport(
    bundle({
      shade: "shade-v1",
      registration: {
        quoteHex: "aa",
        appComposeSha256: "not-in-a-tee",
        tcbInfo: { compose_hash: "not-in-a-tee" },
      },
    }),
    { now: FROZEN },
  );
  const composeFinding = finding(compose, "compose.hash");
  assert.equal(composeFinding.ladder, "NOT_PROVEN");
  assert.match(composeFinding.plainEnglish, /placeholder text "not-in-a-tee"/);
  assert.doesNotMatch(composeFinding.title, /matches the registered event/);

  const matchedCompose = buildReport(
    bundle({
      shade: "shade-v1",
      registration: { quoteHex: "aa", appComposeSha256: REAL, tcbInfo: { compose_hash: `0x${REAL.toUpperCase()}` } },
    }),
    { now: FROZEN },
  );
  assert.equal(finding(matchedCompose, "compose.hash").ladder, "PROVEN");

  const mismatchedCompose = buildReport(
    bundle({
      shade: "shade-v1",
      registration: { quoteHex: "aa", appComposeSha256: REAL, tcbInfo: { compose_hash: OTHER } },
    }),
    { now: FROZEN },
  );
  const missed = finding(mismatchedCompose, "compose.hash");
  assert.equal(missed.ladder, "RISKY");
  assert.equal(missed.title, "Compose hash does not match the registered event");

  const row = measurementRow();
  const placeholder = { ...row, key_provider_event_digest: "not-in-a-tee" };
  const measurements = buildReport(
    bundle({
      shade: "shade-v2",
      methodsPresent: ["get_contract_info", "get_agents", "get_approved_measurements"],
      v2Agents: [
        {
          accountId: "agent.test.near",
          measurements: placeholder,
          validity: "Valid",
          valid: true,
        },
      ],
      approvedMeasurements: [placeholder],
    }),
    { now: FROZEN },
  );
  const approved = finding(measurements, "measurements.approved");
  assert.equal(approved.ladder, "NOT_PROVEN");
  assert.match(approved.plainEnglish, /key-provider digest is the placeholder text "not-in-a-tee"/);
  assert.doesNotMatch(approved.plainEnglish, /match a row/);

  const provenance = assessProvenance({ osImageHash: "not-in-a-tee" });
  assert.equal(provenance.ladder, "NOT_PROVEN");
  assert.match(provenance.detail, /os image hash is the placeholder text "not-in-a-tee"/);
  assert.doesNotMatch(provenance.title, /not a known fixed image/);

  const dstack = assessDstack({
    osImageHash: "not-in-a-tee",
    hasOsImageHashEvent: true,
    hasRootfsHashEvent: false,
  });
  assert.notEqual(dstack.kind, "fixed");
  assert.notEqual(dstack.kind, "not-fixed-image");
  assert.match(dstack.detail, /not a real hash/);
});

function codehashReport(agent: string, approved: string): Report {
  return buildReport(
    bundle({
      shade: "shade-v1",
      agentView: { codehash: agent },
      approvedCodehashes: [{ codehash: approved, txHash: "BzJLYPTcRTvMbui7jAGFMP5SRAjtBBMEbya7Pm8Y1hPN" }],
    }),
    { now: FROZEN },
  );
}

function codehash(report: Report) {
  return finding(report, "codehash.approved");
}

function finding(report: Report, id: string) {
  const item = report.findings.find((entry) => entry.id === id);
  assert.ok(item, id);
  return item;
}

function measurementRow(): ApprovedMeasurementRow {
  return {
    mrtd: "a".repeat(96),
    rtmr0: "b".repeat(96),
    rtmr1: "c".repeat(96),
    rtmr2: "d".repeat(96),
    key_provider_event_digest: "e".repeat(96),
    app_compose_hash_payload: "f".repeat(64),
  };
}

function bundle(patch: Partial<EvidenceBundle>): EvidenceBundle {
  return {
    target: "reflect-adam-mainnet-agent-contract.near",
    network: "mainnet",
    shade: "shade-v1",
    shadeDetail: "fixture",
    methodsPresent: ["get_agent"],
    registration: null,
    compose: null,
    rpcEndpoints: [],
    generatedAt: FROZEN.toISOString(),
    inputOrigin: "chain",
    historySource: "nearblocks",
    ...patch,
  };
}
