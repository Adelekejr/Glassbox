import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditFile, auditValue } from "../src/audit.js";
import { assessApprover, assessContractCode, assessRemove } from "../src/checks/contract.js";
import { assessDstack } from "../src/checks/dstack.js";
import { liveEndpointAllowed, probeLiveGuest } from "../src/checks/liveness.js";
import { assessProvenance } from "../src/checks/provenance.js";
import { base58Encode } from "../src/data/base58.js";
import { hardwareAndOSMeasurements } from "../src/data/shade-measurements.js";
import { SHADE_CONTRACT_TEMPLATES, codeHashOfWasm } from "../src/data/shade-templates.js";
import { diffReports, formatDiff } from "../src/diff.js";
import { buildReport, formatReport } from "../src/report.js";
import { ANCHOR_INSTRUCTIONS, planReportAnchor } from "../src/signed/anchor.js";
import { THREAT_MODEL_DISCLOSURE } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const votronPath = join(here, "fixtures/votron-registration.json");
const leftPath = join(here, "fixtures/diff-left.json");
const rightPath = join(here, "fixtures/diff-right.json");
const wasmPath = join(here, "fixtures/shade-contract-template.wasm");
const FROZEN = new Date("2026-11-04T12:00:00.000Z");

test("every report carries the TEE.fail threat model", async () => {
  const report = await auditValue(JSON.parse(readFileSync(votronPath, "utf8")) as unknown, {
    now: FROZEN,
    label: "votron-fixture",
  });
  const text = `${formatReport(report)}\n${JSON.stringify(report)}`;
  assert.equal(report.threatModel, THREAT_MODEL_DISCLOSURE);
  assert.match(text, /Threat model/);
  assert.match(text, /DDR5/);
  assert.match(text, /dstack context/);
  assert.match(text, /honest operator/);
  assert.match(text, /https:\/\/tee\.fail\//);
  assert.match(text, /registered configuration/i);
  assert.match(text, /proven at registration only/i);
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);
  assert.doesNotMatch(text, /compromised/i);
  assert.doesNotMatch(text, /pwned/i);
  const byId = Object.fromEntries(report.findings.map((finding) => [finding.id, finding]));
  assert.equal(byId["freshness.registration"].ladder, "NOT_PROVEN");
  assert.match(byId["freshness.registration"].plainEnglish, /2025-09-27/);
  assert.match(byId["freshness.registration"].plainEnglish, /days/);
  assert.equal(byId["measurements.provenance"].ladder, "NOT_PROVEN");
  assert.match(byId["measurements.provenance"].title, /unknown/i);
  assert.equal(byId["dstack.range"].ladder, "RISKY");
  assert.match(byId["dstack.range"].plainEnglish, /matches a vulnerable configuration/);
  assert.equal(byId["contract.approver"].ladder, "NOT_PROVEN");
  assert.equal(byId["contract.remove"].ladder, "NOT_PROVEN");
  assert.equal(byId["contract.code"].ladder, "NOT_PROVEN");
  assert.match(byId["contract.code"].title, /not a known Shade template/);
  assert.equal(report.anchor.status, "skipped");
  assert.equal(report.anchor.intent, false);
  assert.match(report.anchor.reason, /does not send a transaction/);
  assert.equal(report.freshness.provenAtRegistrationOnly, true);
  assert.equal(report.freshness.live.attempted, false);
});

test("os image provenance separates a known fixed image, a vulnerable table, and unknown", () => {
  const row = hardwareAndOSMeasurements["0.5.8"]["tdx.small"].rtmrs;
  const fixedHash = "ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6";
  const fixed = assessProvenance({ osImageHash: fixedHash, ...row, rtmr1: "ab".repeat(48) });
  assert.equal(fixed.ladder, "PROVEN");
  assert.match(fixed.title, /known fixed image/);
  const table = assessProvenance(row);
  assert.equal(table.ladder, "RISKY");
  assert.match(table.title, /matches a vulnerable configuration/);
  assert.match(table.detail, /0\.5\.8/);
  const unknown = assessProvenance({});
  assert.equal(unknown.ladder, "NOT_PROVEN");
  assert.match(unknown.title, /unknown/);
  assert.match(unknown.detail, /not a known fixed image/);
  const disagree = assessDstack({
    osImageHash: fixedHash,
    measurements: row,
    hasOsImageHashEvent: true,
    hasRootfsHashEvent: false,
  });
  assert.equal(disagree.kind, "vulnerable-table");
  assert.match(disagree.detail, /disagree/);
  assert.match(disagree.detail, /does not treat the registered configuration as a known fixed image/);
});

test("contract checks name a single full-access key, a broader set, and a missing view", () => {
  const target = "shade.test.near";
  const one = assessApprover({
    shade: "shade-v2",
    target,
    ownerId: target,
    historyLoaded: true,
    approvalHistory: [],
    accessKeys: [{ public_key: "ed25519:one", access_key: { permission: "FullAccess" } }],
  });
  assert.equal(one.ladder, "PROVEN");
  assert.match(one.plainEnglish, /single full-access key/);
  assert.doesNotMatch(one.plainEnglish, /currently running/i);

  const broader = assessApprover({
    shade: "shade-v2",
    target,
    ownerId: target,
    historyLoaded: true,
    approvalHistory: [],
    accessKeys: [
      { public_key: "ed25519:one", access_key: { permission: "FullAccess" } },
      { public_key: "ed25519:two", access_key: { permission: "FullAccess" } },
    ],
  });
  assert.equal(broader.ladder, "RISKY");
  assert.match(broader.plainEnglish, /broader than a single full-access key/);

  const missing = assessApprover({ shade: "shade-v1", target, historyLoaded: false });
  assert.equal(missing.ladder, "NOT_PROVEN");

  const otherOwner = assessApprover({
    shade: "shade-v2",
    target,
    ownerId: "owner.test.near",
    historyLoaded: false,
  });
  assert.equal(otherOwner.ladder, "NOT_PROVEN");
  assert.match(otherOwner.plainEnglish, /keys were not read/);

  const appeared = assessRemove({
    shade: "shade-v2",
    historyLoaded: true,
    changeMethods: [{ name: "remove_measurements", exists: true }],
    approvalHistory: [
      {
        method: "remove_measurements",
        kind: "remove",
        txHash: "abc",
        signer: target,
        success: true,
        detail: "mrtd",
      },
    ],
  });
  assert.equal(appeared.ladder, "PROVEN");
  assert.match(appeared.title, /appears in the indexed history/);

  const unproven = assessRemove({ shade: "shade-v1", historyLoaded: false });
  assert.equal(unproven.ladder, "NOT_PROVEN");

  const matched = assessContractCode({ codeHash: SHADE_CONTRACT_TEMPLATES[0]?.codeHash });
  assert.equal(matched.ladder, "PROVEN");
  assert.match(matched.plainEnglish, /35758f3/);
  const missed = assessContractCode({ codeHash: "2HkUtRxzdaucz8YqQUB24g5Crnn4NiuY2b7fp7SAVFeT" });
  assert.equal(missed.ladder, "NOT_PROVEN");
  const absent = assessContractCode({});
  assert.equal(absent.ladder, "NOT_PROVEN");
});

test("the vendored Shade template wasm hashes to the recorded code hash", () => {
  const hashed = codeHashOfWasm(readFileSync(wasmPath));
  assert.equal(hashed.sha256, SHADE_CONTRACT_TEMPLATES[0]?.sha256);
  assert.equal(hashed.codeHash, SHADE_CONTRACT_TEMPLATES[0]?.codeHash);
  assert.equal(base58Encode(Buffer.alloc(32)), "11111111111111111111111111111111");
});

test("a live guest probe stays not proven and refuses other hosts", async () => {
  assert.equal(liveEndpointAllowed("https://agent.phala.network/quote"), true);
  assert.equal(liveEndpointAllowed("http://agent.phala.network/quote"), false);
  assert.equal(liveEndpointAllowed("https://169.254.169.254/"), false);
  assert.equal(liveEndpointAllowed("https://evil.example/quote"), false);
  let called = false;
  const refusedHost = await probeLiveGuest("http://169.254.169.254/latest", async () => {
    called = true;
    return new Response("no");
  });
  assert.equal(called, false);
  assert.equal(refusedHost.attempted, false);
  assert.match(refusedHost.detail, /not proven/i);
  const blocked = await probeLiveGuest("https://guest.phala.network/quote", async () => new Response("no", { status: 403 }));
  assert.equal(blocked.reachable, false);
  assert.match(blocked.detail, /proven at registration only/i);
  const answered = await probeLiveGuest("https://guest.phala.network/quote", async () => new Response("{}", { status: 200 }));
  assert.equal(answered.reachable, true);
  assert.match(answered.detail, /not proven/i);
  assert.match(answered.detail, /registered configuration/);
});

test("diff of two registration files states what changed", async () => {
  const left = await auditFile(leftPath, { now: FROZEN });
  const right = await auditFile(rightPath, { now: FROZEN });
  const diff = diffReports(left, right);
  const text = formatDiff(diff);
  assert.match(text, /public_logs: false → true/);
  assert.match(text, /os_image_hash: ec43cb8c5e04/);
  assert.match(text, /contract code hash: 7EUTZnq9jErH/);
  assert.match(text, /measurements\.provenance: PROVEN → RISKY/);
  assert.match(text, /known fixed image/);
  assert.match(text, /matches a vulnerable configuration/);
  assert.equal(left.findings.find((finding) => finding.id === "contract.code")?.ladder, "PROVEN");
  assert.equal(right.findings.find((finding) => finding.id === "contract.code")?.ladder, "NOT_PROVEN");
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);
  const same = diffReports(left, left);
  assert.match(same.summary, /No compared field changed/);
});

test("anchoring records intent and does not describe a sent transaction", () => {
  const asked = planReportAnchor({
    reportSha256: "ab".repeat(32),
    network: "testnet",
    contract: "shade.test.near",
    intent: true,
  });
  assert.equal(asked.status, "skipped");
  assert.equal(asked.intent, true);
  assert.match(asked.reason, /does not send a transaction/);
  assert.match(asked.reason, /No NEAR key is loaded/);
  assert.match(ANCHOR_INSTRUCTIONS, /does not spend gas/);
  assert.match(ANCHOR_INSTRUCTIONS, /does not build that transaction/);
  const report = buildReport(
    {
      target: "file.json",
      network: "offline",
      shade: "unknown",
      shadeDetail: "file",
      methodsPresent: [],
      registration: null,
      compose: null,
      rpcEndpoints: [],
      generatedAt: FROZEN.toISOString(),
      historySource: "file",
    },
    { now: FROZEN, anchorIntent: true },
  );
  assert.equal(report.anchor.intent, true);
  assert.equal(report.anchor.status, "skipped");
});
