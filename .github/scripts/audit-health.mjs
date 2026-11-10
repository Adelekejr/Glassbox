import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  AUDIT_GAP_MS,
  NEARBLOCKS_GAP_MS,
  assessAuditReport,
  assessNearblocks,
  nearblocksReceiptsUrl,
} from "./audit-health-lib.mjs";

const AUDIT_URL = process.env.GLASSBOX_AUDIT_URL ?? "https://glassbox-inky.vercel.app/api/audit";
const RESULT = process.env.HEALTH_RESULT ?? "/tmp/glassbox-health.json";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clip(value) {
  const cleaned = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 299)}…` : cleaned;
}

function runUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const id = process.env.GITHUB_RUN_ID;
  if (!server || !repo || !id) return null;
  return `${server}/${repo}/actions/runs/${id}`;
}

async function named(id, name, run) {
  try {
    const result = await run();
    return { id, name, ok: result.ok, detail: clip(result.detail), checkedAt: result.checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id, name, ok: false, detail: clip(message), checkedAt: new Date().toISOString() };
  }
}

async function auditTarget(target) {
  const checkedAt = new Date().toISOString();
  const response = await fetch(AUDIT_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "glassbox-health/0.2",
    },
    body: JSON.stringify({ target }),
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (response.status !== 200) {
    return { ok: false, detail: clip(`HTTP ${response.status}. ${text}`), checkedAt };
  }
  const assessed = assessAuditReport(target, body);
  const detail = assessed.ok ? assessed.detail : `HTTP 200. ${assessed.detail}`;
  return { ok: assessed.ok, detail, checkedAt };
}

async function pingNearblocks(url) {
  const checkedAt = new Date().toISOString();
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "glassbox-auditor/0.1" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const assessed = assessNearblocks(response.status, body);
  return { ok: assessed.ok, detail: `${assessed.detail} ${url}`, checkedAt };
}

export async function runHealthChecks() {
  const checks = [];
  checks.push(await named("audit-votron", "Audit ac-sandbox.votron.testnet", () => auditTarget("ac-sandbox.votron.testnet")));
  console.log(`Waiting ${AUDIT_GAP_MS}ms before the next audit.`);
  await sleep(AUDIT_GAP_MS);
  checks.push(await named("audit-ironshield", "Audit ironshield.near", () => auditTarget("ironshield.near")));
  await sleep(NEARBLOCKS_GAP_MS);
  checks.push(await named("nearblocks-testnet", "NearBlocks testnet receipts", () => pingNearblocks(nearblocksReceiptsUrl("testnet", "ac-sandbox.votron.testnet"))));
  await sleep(NEARBLOCKS_GAP_MS);
  checks.push(await named("nearblocks-mainnet", "NearBlocks mainnet receipts", () => pingNearblocks(nearblocksReceiptsUrl("mainnet", "ironshield.near"))));
  const status = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runUrl: runUrl(),
    checks,
  };
  writeFileSync(RESULT, `${JSON.stringify(status, null, 2)}\n`);
  for (const check of checks) console.log(`${check.ok ? "ok" : "FAIL"} ${check.name}: ${check.detail}`);
  return checks.every((check) => check.ok);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ok = await runHealthChecks();
  process.exit(ok ? 0 : 1);
}
