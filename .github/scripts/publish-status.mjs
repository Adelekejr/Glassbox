/**
 * Writes /tmp/glassbox-health.json onto the public `status` branch.
 * Uses the Actions token only in this job. The site later reads the raw file
 * with no token. If this file is missing, a failing record is published so the
 * site does not keep showing an older pass.
 */
import { readFileSync } from "node:fs";

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const resultPath = process.env.HEALTH_RESULT ?? "/tmp/glassbox-health.json";

function fallbackStatus() {
  const server = process.env.GITHUB_SERVER_URL;
  const id = process.env.GITHUB_RUN_ID;
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    runUrl: server && repo && id ? `${server}/${repo}/actions/runs/${id}` : null,
    checks: [
      {
        id: "health-job",
        name: "Daily health check",
        ok: false,
        detail: "The health check did not write a result.",
        checkedAt: now,
      },
    ],
  };
}

function loadStatus() {
  try {
    return JSON.parse(readFileSync(resultPath, "utf8"));
  } catch {
    return fallbackStatus();
  }
}

async function gh(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

function messageOf(body) {
  if (!body || typeof body !== "object") return "";
  return typeof body.message === "string" ? body.message : "";
}

async function ensureBranch() {
  const existing = await gh(`/repos/${repo}/branches/status`);
  if (existing.status === 200) return;
  if (existing.status !== 404) {
    throw new Error(`Could not read the status branch (HTTP ${existing.status}). ${messageOf(existing.body)}`);
  }
  const main = await gh(`/repos/${repo}/git/ref/heads/main`);
  if (main.status !== 200 || !main.body?.object?.sha) {
    throw new Error(`Could not read main (HTTP ${main.status}).`);
  }
  const created = await gh(`/repos/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: "refs/heads/status", sha: main.body.object.sha }),
  });
  if (created.status !== 201 && created.status !== 422) {
    throw new Error(`Could not create the status branch (HTTP ${created.status}). ${messageOf(created.body)}`);
  }
}

async function publish(content) {
  const current = await gh(`/repos/${repo}/contents/health.json?ref=status`);
  if (current.status !== 200 && current.status !== 404) {
    throw new Error(`Could not read health.json (HTTP ${current.status}). ${messageOf(current.body)}`);
  }
  const sha = current.status === 200 ? current.body.sha : undefined;
  const put = await gh(`/repos/${repo}/contents/health.json`, {
    method: "PUT",
    body: JSON.stringify({
      message: "Record daily health check",
      branch: "status",
      content: Buffer.from(content).toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (put.status === 200 || put.status === 201) return;
  const note = messageOf(put.body);
  if (put.status === 422 && /identical/i.test(note)) return;
  throw new Error(`Could not publish health.json (HTTP ${put.status}). ${note}`);
}

if (!repo || !token) {
  console.error("GITHUB_REPOSITORY and GITHUB_TOKEN are required to publish the status file.");
  process.exit(1);
}

const status = loadStatus();
const content = `${JSON.stringify(status, null, 2)}\n`;
await ensureBranch();
await publish(content);
console.log("Published health.json on the status branch.");
