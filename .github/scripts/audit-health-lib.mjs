/**
 * Checks for the daily health job.
 * NearBlocks path matches packages/core/src/near/history.ts:
 * GET /v3/accounts/{account}/receipts?method=&limit=25
 * on api.nearblocks.io and api-testnet.nearblocks.io.
 */

export const AUDIT_GAP_MS = 75_000;
export const NEARBLOCKS_GAP_MS = 12_000;

const FAILED_HISTORY = /failed history read|Could not read history/i;

export function nearblocksReceiptsUrl(network, accountId, method = "register_agent") {
  const host = network === "testnet" ? "https://api-testnet.nearblocks.io" : "https://api.nearblocks.io";
  const params = new URLSearchParams({ method, limit: "25" });
  return `${host}/v3/accounts/${encodeURIComponent(accountId)}/receipts?${params.toString()}`;
}

export function assessAuditReport(target, body) {
  const report = body && typeof body === "object" ? body.report : null;
  if (!report || !Array.isArray(report.findings)) {
    return { ok: false, detail: "The response was not an audit report." };
  }
  const problems = [];
  if (historyFailed(report)) problems.push("history read failed");
  if (target === "ac-sandbox.votron.testnet") {
    if (!quoteLoaded(report)) problems.push("registration quote was not loaded");
    if (!codeHashLoaded(report)) problems.push("code hash was not loaded");
    if (!fullAccessRisky(report)) problems.push("full-access key was not RISKY");
  }
  if (problems.length > 0) return { ok: false, detail: `${problems.join("; ")}.` };
  if (target === "ac-sandbox.votron.testnet") {
    return {
      ok: true,
      detail: "HTTP 200. History loaded. Registration quote and code hash loaded. Full-access key is RISKY.",
    };
  }
  return { ok: true, detail: "HTTP 200. History loaded." };
}

export function assessNearblocks(status, body) {
  if (status !== 200) return { ok: false, detail: `HTTP ${status}.` };
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    return { ok: false, detail: "The response was not a v3 receipts list." };
  }
  return { ok: true, detail: `HTTP 200. ${body.data.length} receipt rows on the first page.` };
}

function historyFailed(report) {
  return report.findings.some((finding) => FAILED_HISTORY.test(`${finding?.title ?? ""} ${finding?.plainEnglish ?? ""}`));
}

function quoteLoaded(report) {
  const registration = report.findings.find((finding) => finding?.id === "tdx.registration");
  if (!registration) return false;
  if (registration.title === "No registration quote was loaded") return false;
  return !/registration quote was not loaded|did not include a TDX quote|quote was not verified/i.test(registration.plainEnglish ?? "");
}

function codeHashLoaded(report) {
  const app = report.facts?.appCodehash;
  const contract = report.facts?.contractCodeHash;
  const finding = report.findings.find((item) => item?.id === "codehash.approved");
  if (typeof app !== "string" || app.length < 8) return false;
  if (typeof contract !== "string" || contract.length < 8) return false;
  if (!finding) return false;
  return !/was not loaded|not a real hash|Could not read history/i.test(`${finding.title ?? ""} ${finding.plainEnglish ?? ""}`);
}

function fullAccessRisky(report) {
  const keys = report.findings.find((finding) => finding?.id === "access.keys");
  return Boolean(keys && keys.ladder === "RISKY" && /Full-access key/i.test(keys.plainEnglish ?? ""));
}
