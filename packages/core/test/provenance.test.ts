import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditFile, auditValue } from "../src/audit.js";
import { buildReport, formatReport } from "../src/report.js";
import { isLiveChainProof } from "../src/provenance.js";
import type { EvidenceBundle, Report } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const leftPath = join(here, "fixtures/diff-left.json");
const votronPath = join(here, "fixtures/votron-registration.json");
const FROZEN = new Date("2026-11-04T12:00:00.000Z");

test("a file report exposes provenance and cannot be consumed as live chain proof", async () => {
  const report = await auditFile(leftPath, { now: FROZEN });
  assertNoLiveChainProof(report);
  const code = finding(report, "contract.code");
  assert.equal(code.ladder, "PROVEN");
  assert.equal(code.provenance.evidenceSource, "file");
  assert.equal(code.provenance.observationKind, "computed");
  assert.equal(code.provenance.liveChain, false);
  assert.match(code.provenance.label, /supplied code hash/i);
  assert.match(code.provenance.label, /not a live chain observation/i);
  assert.match(formatReport(report), /Provenance: file \/ computed/);
  const machine = JSON.parse(JSON.stringify(report)) as Report;
  assert.equal(finding(machine, "contract.code").provenance.liveChain, false);
  assert.equal(isLiveChainProof(finding(machine, "contract.code")), false);
});

test("a capture file keeps quote verification and does not treat file equality as chain proof", async () => {
  const report = await auditFile(votronPath, { now: FROZEN });
  assertNoLiveChainProof(report);
  const signature = finding(report, "tdx.signature");
  assert.equal(signature.ladder, "PROVEN");
  assert.equal(signature.provenance.evidenceSource, "file");
  assert.equal(signature.provenance.observationKind, "computed");
  assert.match(signature.provenance.label, /Verification of supplied quote bytes/);
  assert.match(signature.provenance.label, /Not a live chain observation/);
  const codehash = finding(report, "codehash.approved");
  assert.equal(codehash.ladder, "PROVEN");
  assert.equal(codehash.provenance.evidenceSource, "file");
  assert.equal(codehash.provenance.observationKind, "file");
  assert.match(codehash.provenance.label, /Equality of values in the supplied file/);
  const keys = finding(report, "access.keys");
  assert.equal(keys.provenance.observationKind, "file");
  assert.equal(keys.provenance.liveChain, false);
});

test("pasted JSON is labelled paste, not chain", async () => {
  const pasted = await auditValue(JSON.parse(readFileSync(leftPath, "utf8")) as unknown, { now: FROZEN });
  assertNoLiveChainProof(pasted);
  const code = finding(pasted, "contract.code");
  assert.equal(code.provenance.evidenceSource, "paste");
  assert.equal(code.provenance.observationKind, "computed");
  assert.match(formatReport(pasted), /Provenance: paste \/ computed/);
  assert.match(code.provenance.label, /not a live chain observation/i);
});

test("a chain-read access-key row can be live chain proof, and the same keys from a file cannot", () => {
  const keys = [
    {
      public_key: "ed25519:one",
      access_key: {
        permission: {
          FunctionCall: {
            allowance: "1000",
            receiver_id: "shade.test.near",
            method_names: ["get_agent"],
          },
        },
      },
    },
  ];
  const chain = buildReport(bundle({ inputOrigin: "chain", historySource: "nearblocks", network: "testnet", accessKeys: keys }), {
    now: FROZEN,
  });
  const live = finding(chain, "access.keys");
  assert.equal(live.ladder, "PROVEN");
  assert.equal(live.provenance.evidenceSource, "chain");
  assert.equal(live.provenance.observationKind, "chain");
  assert.equal(isLiveChainProof(live), true);

  const file = buildReport(bundle({ inputOrigin: "file", historySource: "file", network: "offline", accessKeys: keys }), {
    now: FROZEN,
  });
  const supplied = finding(file, "access.keys");
  assert.equal(supplied.ladder, "PROVEN");
  assert.equal(supplied.provenance.observationKind, "file");
  assert.equal(isLiveChainProof(supplied), false);
});

function assertNoLiveChainProof(report: Report): void {
  const live = report.findings.filter(isLiveChainProof);
  assert.deepEqual(live.map((item) => item.id), []);
  for (const item of report.findings) {
    assert.notEqual(item.provenance.observationKind, "chain");
    assert.notEqual(item.provenance.evidenceSource, "chain");
    assert.equal(item.provenance.liveChain, false);
    assert.match(item.provenance.label, /not a live/i);
  }
}

function finding(report: Report, id: string) {
  const item = report.findings.find((entry) => entry.id === id);
  assert.ok(item, id);
  return item;
}

function bundle(patch: Partial<EvidenceBundle> & Pick<EvidenceBundle, "inputOrigin" | "historySource" | "network">): EvidenceBundle {
  return {
    target: "shade.test.near",
    shade: "shade-v1",
    shadeDetail: "fixture",
    methodsPresent: ["get_agent"],
    registration: null,
    compose: null,
    rpcEndpoints: [],
    generatedAt: FROZEN.toISOString(),
    ...patch,
  };
}
