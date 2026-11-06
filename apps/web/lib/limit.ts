import { timingSafeEqual } from "node:crypto";

/**
 * Admission for POST /api/audit.
 *
 * A process-local counter does not hold across Vercel instances. The route
 * uses one of these modes:
 *
 * 1. Shared budget, when Upstash Redis or Vercel KV REST credentials are set.
 *    This is the preferred production limiter. 10 audits per minute and 2 in
 *    flight, counted for the whole deployment. Redis wins when it is present,
 *    including when GLASSBOX_PUBLIC_DEMO is also set.
 * 2. Restricted, when GLASSBOX_AUDIT_TOKEN is set and no shared store is configured.
 *    Callers must send header x-glassbox-audit-token. A process-local cap still applies.
 * 3. Explicit public demo, when GLASSBOX_PUBLIC_DEMO=1 and neither of the above is set.
 *    Process-local demo mode. Anonymous, with the process-local cap. That cap
 *    is not deployment-wide.
 * 4. Closed. None of the above: 403, and the handler does not call RPC.
 */
export const AUDIT_WINDOW_MS = 60_000;
export const AUDIT_MAX_PER_WINDOW = 10;
export const AUDIT_MAX_INFLIGHT = 2;

const timestamps: number[] = [];

export function resetAuditLimiter(): void {
  timestamps.length = 0;
}

/** Returns false when this process has already accepted the window's quota. */
export function takeAuditSlot(now = Date.now()): boolean {
  const cutoff = now - AUDIT_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
  if (timestamps.length >= AUDIT_MAX_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}

export type AuditLimitScope = "shared" | "token" | "process" | "closed";

export interface AuditAdmission {
  ok: boolean;
  status: 200 | 401 | 403 | 429 | 503;
  error?: string;
  scope: AuditLimitScope;
  headers: Record<string, string>;
  /** Decrements the shared in-flight counter. Absent when this admission did not take one. */
  release?: () => Promise<void>;
}

export async function admitAudit(input: {
  now?: number;
  env?: Record<string, string | undefined>;
  token?: string | null;
  fetchImpl?: typeof fetch;
} = {}): Promise<AuditAdmission> {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const store = readStore(env);
  if (store.kind === "invalid") {
    return deny(503, "closed", "The shared audit budget is misconfigured.");
  }
  if (store.kind === "redis") {
    return admitShared(store, now, fetchImpl);
  }
  const expected = env.GLASSBOX_AUDIT_TOKEN?.trim();
  if (expected) {
    if (!tokenMatches(expected, input.token ?? null)) {
      return deny(401, "token", "This audit endpoint requires header x-glassbox-audit-token.");
    }
    if (!takeAuditSlot(now)) {
      return deny(429, "token", "Too many audits from this server. Wait a minute and retry.");
    }
    return allow("token");
  }
  if (publicDemo(env)) {
    if (!takeAuditSlot(now)) {
      return deny(429, "process", "Too many audits from this server. Wait a minute and retry.");
    }
    return allow("process");
  }
  return deny(
    403,
    "closed",
    "This deployment is not accepting anonymous audits. Configure Upstash Redis or Vercel KV, set GLASSBOX_AUDIT_TOKEN, or set GLASSBOX_PUBLIC_DEMO=1.",
  );
}

type Store =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "redis"; url: string; token: string };

function readStore(env: Record<string, string | undefined>): Store {
  const url = first(env.UPSTASH_REDIS_REST_URL, env.KV_REST_API_URL);
  const token = first(env.UPSTASH_REDIS_REST_TOKEN, env.KV_REST_API_TOKEN);
  if (!url && !token) return { kind: "none" };
  if (!url || !token || !url.startsWith("https://")) return { kind: "invalid" };
  return { kind: "redis", url: url.replace(/\/$/, ""), token };
}

function first(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function publicDemo(env: Record<string, string | undefined>): boolean {
  const value = env.GLASSBOX_PUBLIC_DEMO?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function admitShared(
  store: { url: string; token: string },
  now: number,
  fetchImpl: typeof fetch,
): Promise<AuditAdmission> {
  const windowId = Math.floor(now / AUDIT_WINDOW_MS);
  const windowKey = `glassbox:audit:${windowId}`;
  let count: number;
  try {
    const results = await redis(store, [
      ["INCR", windowKey],
      ["EXPIRE", windowKey, "180", "NX"],
    ], fetchImpl);
    count = asCount(results[0]);
  } catch {
    return deny(503, "shared", "The shared audit budget could not be checked. Retry shortly.");
  }
  if (count > AUDIT_MAX_PER_WINDOW) {
    return deny(429, "shared", "Too many audits for this deployment. Wait a minute and retry.");
  }
  let inflight: number;
  try {
    const results = await redis(store, [
      ["INCR", "glassbox:audit:inflight"],
      ["EXPIRE", "glassbox:audit:inflight", "120", "NX"],
    ], fetchImpl);
    inflight = asCount(results[0]);
  } catch {
    return deny(503, "shared", "The shared audit budget could not be checked. Retry shortly.");
  }
  if (inflight > AUDIT_MAX_INFLIGHT) {
    try {
      await redis(store, [["DECR", "glassbox:audit:inflight"]], fetchImpl);
    } catch {
      // The in-flight key expires. A missed decrement must not open the route.
    }
    return deny(429, "shared", "Too many audits are running. Wait a minute and retry.");
  }
  return {
    ...allow("shared"),
    release: async () => {
      try {
        await redis(store, [["DECR", "glassbox:audit:inflight"]], fetchImpl);
      } catch {
        // Best-effort. The key expires if a release is lost.
      }
    },
  };
}

async function redis(
  store: { url: string; token: string },
  commands: string[][],
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const response = await fetchImpl(`${store.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`redis HTTP ${response.status}`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body) || body.length < commands.length) throw new Error("redis pipeline");
  return body.map((item) => {
    if (item && typeof item === "object" && "result" in item) return (item as { result: unknown }).result;
    return item;
  });
}

function asCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count)) throw new Error("redis count");
  return count;
}

function tokenMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function allow(scope: AuditLimitScope): AuditAdmission {
  return { ok: true, status: 200, scope, headers: scopeHeaders(scope) };
}

function deny(status: 401 | 403 | 429 | 503, scope: AuditLimitScope, error: string): AuditAdmission {
  const headers = scopeHeaders(scope);
  if (status === 429 || status === 503) headers["retry-after"] = "60";
  return { ok: false, status, error, scope, headers };
}

function scopeHeaders(scope: AuditLimitScope): Record<string, string> {
  return { "x-glassbox-rate-limit-scope": scope };
}
