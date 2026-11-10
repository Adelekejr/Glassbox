import assert from "node:assert/strict";
import test from "node:test";
import { assessAuditReport, assessNearblocks, nearblocksReceiptsUrl, AUDIT_GAP_MS, NEARBLOCKS_GAP_MS } from "./audit-health-lib.mjs";

const VOTRON = "ac-sandbox.votron.testnet";

function report(extra = {}) {
  return {
    report: {
      findings: [
        { id: "tdx.registration", title: "TCB status at registration is UpToDate", ladder: "PROVEN", plainEnglish: "The registered configuration's TCB status is UpToDate." },
        { id: "codehash.approved", title: "App codehash is in approve_codehash history", ladder: "PROVEN", plainEnglish: "get_agent returns codehash ab." },
        { id: "access.keys", title: "Access keys can change the account", ladder: "RISKY", plainEnglish: "Full-access key ed25519:abc. The holder can redeploy the contract." },
      ],
      facts: {
        appCodehash: "ab".repeat(32),
        contractCodeHash: "cd".repeat(32),
      },
      ...extra,
    },
  };
}

test("the health job calls the same NearBlocks v3 receipts path the auditor uses", () => {
  assert.ok(AUDIT_GAP_MS >= 60_000);
  assert.ok(NEARBLOCKS_GAP_MS >= 10_500);
  const testnet = nearblocksReceiptsUrl("testnet", VOTRON);
  const mainnet = nearblocksReceiptsUrl("mainnet", "ironshield.near");
  assert.equal(testnet, "https://api-testnet.nearblocks.io/v3/accounts/ac-sandbox.votron.testnet/receipts?method=register_agent&limit=25");
  assert.equal(mainnet, "https://api.nearblocks.io/v3/accounts/ironshield.near/receipts?method=register_agent&limit=25");
});

test("votron is sane only when history, the quote, the code hash, and the risky key are present", () => {
  assert.equal(assessAuditReport(VOTRON, report()).ok, true);
  assert.match(assessAuditReport(VOTRON, report()).detail, /Full-access key is RISKY/);

  const failed = report();
  failed.report.findings.push({
    id: "freshness.registration",
    title: "Attestation is proven at registration only",
    plainEnglish: "Could not read history for register_agent. A failed history read is not an empty index.",
  });
  assert.match(assessAuditReport(VOTRON, failed).detail, /history read failed/);

  const noQuote = report();
  noQuote.report.findings[0] = {
    id: "tdx.registration",
    title: "No registration quote was loaded",
    plainEnglish: "No successful register_agent arguments were loaded, so the TDX quote was not verified.",
  };
  assert.match(assessAuditReport(VOTRON, noQuote).detail, /registration quote was not loaded/);

  const noHash = report();
  noHash.report.facts.appCodehash = null;
  assert.match(assessAuditReport(VOTRON, noHash).detail, /code hash was not loaded/);

  const safeKeys = report();
  safeKeys.report.findings[2] = { id: "access.keys", ladder: "PROVEN", title: "limited", plainEnglish: "Every access key is a function-call key." };
  assert.match(assessAuditReport(VOTRON, safeKeys).detail, /full-access key was not RISKY/);
});

test("ironshield only needs a loaded history, and NearBlocks must return a v3 data list", () => {
  const body = report();
  body.report.findings[0] = {
    id: "tdx.registration",
    title: "No registration quote was loaded",
    plainEnglish: "No successful register_agent arguments were loaded, so the TDX quote was not verified.",
  };
  const iron = assessAuditReport("ironshield.near", body);
  assert.equal(iron.ok, true);
  assert.match(iron.detail, /History loaded/);

  const unread = report();
  unread.report.findings[0].plainEnglish = "Could not read history for register_agent. A failed history read is not an empty index.";
  assert.equal(assessAuditReport("ironshield.near", unread).ok, false);

  assert.equal(assessNearblocks(200, { data: [] }).ok, true);
  assert.equal(assessNearblocks(410, { txns: [] }).ok, false);
  assert.equal(assessNearblocks(200, { txns: [] }).ok, false);
  assert.equal(assessAuditReport(VOTRON, { error: "closed" }).ok, false);
});
