import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/audit/route.js";
import { AUDIT_MAX_INFLIGHT, AUDIT_MAX_PER_WINDOW, admitAudit, resetAuditLimiter } from "./limit.js";

const REDIS_ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "test-token",
};

test("a shared budget rejects the next audit after the window quota", async () => {
  const state = { window: 0, inflight: 0 };
  const fetchImpl = redisFetch(state);
  resetAuditLimiter();
  for (let index = 0; index < AUDIT_MAX_PER_WINDOW; index += 1) {
    const admission = await admitAudit({ env: REDIS_ENV, now: 1_700_000_000_000, fetchImpl });
    assert.equal(admission.ok, true);
    assert.equal(admission.scope, "shared");
    await admission.release?.();
  }
  const blocked = await admitAudit({ env: REDIS_ENV, now: 1_700_000_000_000, fetchImpl });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.scope, "shared");
  assert.equal(blocked.headers["retry-after"], "60");
  assert.equal(state.inflight, 0);
});

test("shared in-flight slots fail closed and release", async () => {
  const state = { window: 0, inflight: 0 };
  const fetchImpl = redisFetch(state);
  const held = [];
  for (let index = 0; index < AUDIT_MAX_INFLIGHT; index += 1) {
    const admission = await admitAudit({ env: REDIS_ENV, now: 1_700_000_060_000, fetchImpl });
    assert.equal(admission.ok, true);
    held.push(admission);
  }
  const blocked = await admitAudit({ env: REDIS_ENV, now: 1_700_000_060_000, fetchImpl });
  assert.equal(blocked.status, 429);
  assert.match(blocked.error ?? "", /running/);
  assert.equal(state.inflight, AUDIT_MAX_INFLIGHT);
  await held[0]?.release?.();
  const next = await admitAudit({ env: REDIS_ENV, now: 1_700_000_060_000, fetchImpl });
  assert.equal(next.ok, true);
  await next.release?.();
  await held[1]?.release?.();
  assert.equal(state.inflight, 0);
});

test("a Redis failure does not open the route", async () => {
  const admission = await admitAudit({
    env: REDIS_ENV,
    now: 1_700_000_120_000,
    fetchImpl: async (input) => {
      assert.match(String(input), /^https:\/\/redis\.example\//);
      return new Response("no", { status: 500 });
    },
  });
  assert.equal(admission.status, 503);
  assert.equal(admission.ok, false);
});

test("a non-https budget URL is rejected", async () => {
  const admission = await admitAudit({
    env: { UPSTASH_REDIS_REST_URL: "http://redis.example", UPSTASH_REDIS_REST_TOKEN: "t" },
    fetchImpl: async () => {
      throw new Error("fetch should not run");
    },
  });
  assert.equal(admission.status, 503);
});

test("without a shared budget the route is closed unless a token or explicit demo flag is set", async () => {
  const closed = await admitAudit({ env: {}, fetchImpl: async () => {
    throw new Error("fetch should not run");
  } });
  assert.equal(closed.status, 403);
  assert.match(closed.error ?? "", /not accepting anonymous audits/);

  const missing = await admitAudit({ env: { GLASSBOX_AUDIT_TOKEN: "sekret" }, token: "nope" });
  assert.equal(missing.status, 401);
  const allowed = await admitAudit({ env: { GLASSBOX_AUDIT_TOKEN: "sekret" }, token: "sekret", now: 50_000 });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.scope, "token");

  resetAuditLimiter();
  const demoEnv = { GLASSBOX_PUBLIC_DEMO: "1" };
  for (let index = 0; index < AUDIT_MAX_PER_WINDOW; index += 1) {
    assert.equal((await admitAudit({ env: demoEnv, now: 90_000 })).ok, true);
  }
  assert.equal((await admitAudit({ env: demoEnv, now: 90_000 })).status, 429);
  resetAuditLimiter();
});

test("POST /api/audit rejects before RPC when the deployment is closed", async () => {
  await withAuditEnv({}, async () => {
    const calls = stubFetch(() => {
      throw new Error("live RPC must not be called");
    });
    try {
      const response = await POST(auditRequest({ target: "ac-sandbox.votron.testnet" }));
      assert.equal(response.status, 403);
      const body = (await response.json()) as { error?: string; scope?: string };
      assert.equal(body.scope, "closed");
      assert.match(body.error ?? "", /anonymous/);
      assert.equal(calls(), 0);
    } finally {
      calls.restore();
    }
  });
});

test("POST /api/audit returns the shared budget rejection without calling NEAR", async () => {
  await withAuditEnv(REDIS_ENV, async () => {
    const calls = stubFetch(async (input) => {
      assert.match(String(input), /^https:\/\/redis\.example\//);
      return new Response(JSON.stringify([{ result: AUDIT_MAX_PER_WINDOW + 1 }, { result: 1 }]), { status: 200 });
    });
    try {
      const response = await POST(auditRequest({ target: "ac-sandbox.votron.testnet" }));
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("x-glassbox-rate-limit-scope"), "shared");
      const body = (await response.json()) as { scope?: string };
      assert.equal(body.scope, "shared");
      assert.equal(calls(), 1);
    } finally {
      calls.restore();
    }
  });
});

function redisFetch(state: { window: number; inflight: number }): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://redis.example/")) throw new Error(`unexpected ${url}`);
    const commands = JSON.parse(String(init?.body)) as string[][];
    const results = commands.map(([op, key]) => {
      if (op === "INCR" && key === "glassbox:audit:inflight") {
        state.inflight += 1;
        return state.inflight;
      }
      if (op === "DECR" && key === "glassbox:audit:inflight") {
        state.inflight -= 1;
        return state.inflight;
      }
      if (op === "INCR") {
        state.window += 1;
        return state.window;
      }
      if (op === "EXPIRE") return 1;
      throw new Error(op ?? "empty");
    });
    return new Response(JSON.stringify(results.map((result) => ({ result }))), { status: 200 });
  };
}

function auditRequest(body: unknown): Request {
  return new Request("http://glassbox.local/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const AUDIT_ENV_KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "GLASSBOX_AUDIT_TOKEN",
  "GLASSBOX_PUBLIC_DEMO",
] as const;

async function withAuditEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(AUDIT_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of AUDIT_ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    await run();
  } finally {
    for (const key of AUDIT_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function stubFetch(impl: typeof fetch): (() => number) & { restore: () => void } {
  const previous = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    count += 1;
    return impl(input, init);
  };
  const read = (() => count) as (() => number) & { restore: () => void };
  read.restore = () => {
    globalThis.fetch = previous;
  };
  return read;
}
