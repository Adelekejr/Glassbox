import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface SampleFinding {
  provenance?: { evidenceSource?: string; liveChain?: boolean };
}

interface SavedSample {
  kind: string;
  notice: string;
  payload: {
    report: {
      summary: { proven: number; notProven: number; risky: number };
      findings: SampleFinding[];
      inputs: { collateralSource: string; freshCollateralSource: string | null };
    };
  };
}

test("the saved sample is the offline capture, not a live chain read", () => {
  const sample = JSON.parse(readFileSync(new URL("../public/saved-sample.json", import.meta.url), "utf8")) as SavedSample;
  assert.equal(sample.kind, "saved-sample");
  assert.match(sample.notice, /not a live account/i);
  assert.match(sample.notice, /CLI local file/);
  assert.equal(sample.payload.report.summary.risky, 8);
  assert.equal(sample.payload.report.summary.notProven, 10);
  assert.equal(sample.payload.report.summary.proven, 14);
  assert.equal(sample.payload.report.inputs.collateralSource, "file");
  assert.equal(sample.payload.report.inputs.freshCollateralSource, null);
  assert.ok(sample.payload.report.findings.length > 0);
  for (const finding of sample.payload.report.findings) {
    assert.notEqual(finding.provenance?.evidenceSource, "chain");
    assert.equal(finding.provenance?.liveChain, false);
  }
});
