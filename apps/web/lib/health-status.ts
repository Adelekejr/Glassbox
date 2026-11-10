/**
 * Public daily-check result.
 * The site reads a file on the `status` branch. No token is used here.
 * A missing or unreadable file is "Status unknown", never a pass.
 */
export const HEALTH_STATUS_URL = "https://raw.githubusercontent.com/Adelekejr/Glassbox/status/health.json";
export const HEALTH_REVALIDATE_SECONDS = 600;
export const HEALTH_WORKFLOW_URL = "https://github.com/Adelekejr/Glassbox/actions/workflows/health.yml";

const RUN_URL = /^https:\/\/github\.com\/Adelekejr\/Glassbox\/actions\/runs\/\d+$/;

export interface HealthCheckRow {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  checkedAt: string;
}

export type HealthState = "passing" | "failing" | "unknown";

export interface HealthView {
  state: HealthState;
  label: "All checks passing" | "Check failing" | "Status unknown";
  /** "Last checked …" or "Last checked unknown". */
  checkedLabel: string;
  runUrl: string | null;
  checks: HealthCheckRow[];
}

export function unknownHealth(): HealthView {
  return {
    state: "unknown",
    label: "Status unknown",
    checkedLabel: "Last checked unknown",
    runUrl: null,
    checks: [],
  };
}

export function parseHealthStatus(value: unknown): HealthView {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unknownHealth();
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.checks) || record.checks.length === 0) return unknownHealth();
  const checks: HealthCheckRow[] = [];
  for (const item of record.checks.slice(0, 12)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return unknownHealth();
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.ok !== "boolean") return unknownHealth();
    if (typeof row.detail !== "string" || typeof row.checkedAt !== "string") return unknownHealth();
    if (!row.id.trim() || !row.name.trim() || !Number.isFinite(Date.parse(row.checkedAt))) return unknownHealth();
    checks.push({
      id: clip(row.id, 80),
      name: clip(row.name, 120),
      ok: row.ok,
      detail: clip(row.detail, 300),
      checkedAt: new Date(row.checkedAt).toISOString(),
    });
  }
  if (checks.length === 0) return unknownHealth();
  const failing = checks.some((check) => !check.ok);
  const latest = checks.map((check) => check.checkedAt).sort().at(-1) ?? null;
  const formatted = latest ? formatCheckedAt(latest) : null;
  if (!formatted) return unknownHealth();
  const runUrl = typeof record.runUrl === "string" && RUN_URL.test(record.runUrl) ? record.runUrl : null;
  return {
    state: failing ? "failing" : "passing",
    label: failing ? "Check failing" : "All checks passing",
    checkedLabel: `Last checked ${formatted}`,
    runUrl,
    checks,
  };
}

export function formatCheckedAt(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getUTCDate();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export async function loadHealthStatus(fetchImpl: typeof fetch = fetch): Promise<HealthView> {
  try {
    const response = await fetchImpl(HEALTH_STATUS_URL, {
      headers: { accept: "application/json" },
      next: { revalidate: HEALTH_REVALIDATE_SECONDS },
    });
    if (!response.ok) return unknownHealth();
    return parseHealthStatus(await response.json());
  } catch {
    return unknownHealth();
  }
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
