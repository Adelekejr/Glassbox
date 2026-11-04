import { createHash } from "node:crypto";
import type { ComposeFacts, ImageRef } from "../types.js";

/**
 * Names that look like key material in an app compose.
 * PUBLIC_* names are not flagged unless they also match a private marker.
 * API_CODEHASH is not an API key.
 */
export function isSecretEnvName(name: string): boolean {
  if (/^PUBLIC_/i.test(name) && !/PRIVATE|SECRET|SEED|MNEMONIC|API_KEY|PASSWORD/i.test(name)) {
    return false;
  }
  return /PRIVATE_KEY|API_KEY|SEED|MNEMONIC|SECRET|PASSWORD/i.test(name) || /(^|_)TOKEN($|_)/i.test(name);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function classifyImage(ref: string): ImageRef {
  const trimmed = ref.trim().replace(/^["']|["']$/g, "");
  const digest = trimmed.match(/@sha256:([a-fA-F0-9]{64})/i);
  if (digest) {
    return {
      ref: trimmed,
      pinned: true,
      digest: digest[1].toLowerCase(),
      tag: null,
      implicitLatest: false,
    };
  }
  const tag = trimmed.match(/:([^:/@]+)$/);
  return {
    ref: trimmed,
    pinned: false,
    digest: null,
    tag: tag ? tag[1] : "latest",
    implicitLatest: !tag,
  };
}

export function parseCompose(input: unknown): ComposeFacts | null {
  if (input === undefined || input === null) return null;
  const root = typeof input === "string" ? parseMaybeJson(input) : input;
  const text = typeof input === "string" ? input : "";
  const obj = root && typeof root === "object" ? (root as Record<string, unknown>) : null;
  const tee = obj && typeof obj.tee_config === "object" ? (obj.tee_config as Record<string, unknown>) : null;
  const docker =
    typeof obj?.docker_compose_file === "string"
      ? obj.docker_compose_file
      : typeof obj?.dockerCompose === "string"
        ? obj.dockerCompose
        : obj
          ? ""
          : text;
  const scanText = docker || text;
  const extracted = extractDocker(scanText);
  const envNames = new Set<string>(extracted.envNames);
  collectEnvNames(obj?.allowed_envs, envNames);
  collectEnvNames(obj?.env, envNames);
  collectEnvNames(obj?.environment, envNames);
  collectEnvNames(tee?.env, envNames);
  const declared = firstString(obj?.dstack_version, tee?.dstack_version) ?? yamlScalar(text, "dstack_version");
  const publicLogs = firstBool(obj?.public_logs, tee?.public_logs) ?? yamlBool(text, "public_logs");
  const publicSysinfo = firstBool(obj?.public_sysinfo, tee?.public_sysinfo) ?? yamlBool(text, "public_sysinfo");
  if (!obj && !scanText.trim()) return null;
  return {
    publicLogs,
    publicSysinfo,
    dstackVersion: declared,
    versionDeclared: Boolean(declared),
    envNames: [...envNames],
    images: extracted.images,
    referencesTappdSocket: scanText.includes("tappd.sock"),
    hasDockerCompose: Boolean(docker.trim()) || /^\s*services:/m.test(text) || extracted.images.length > 0,
  };
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstBool(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function yamlScalar(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^\\s*${key}\\s*:\\s*["']?([^\\n"']+)`, "m"));
  return match?.[1]?.trim() ?? null;
}

function yamlBool(text: string, key: string): boolean | null {
  const raw = yamlScalar(text, key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function collectEnvNames(value: unknown, into: Set<string>): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        const name = item.split("=", 1)[0]?.trim();
        if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) into.add(name);
      }
    }
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) into.add(key);
  }
}

function extractDocker(text: string): { images: ImageRef[]; envNames: string[] } {
  const images: ImageRef[] = [];
  const envNames: string[] = [];
  if (!text) return { images, envNames };
  const lines = text.split(/\r?\n/);
  let envIndent: number | null = null;
  for (const line of lines) {
    const image = line.match(/^\s*image:\s*["']?(\S+?)["']?\s*$/);
    if (image) {
      images.push(classifyImage(image[1]));
      envIndent = null;
      continue;
    }
    const header = line.match(/^(\s*)environment:\s*$/);
    if (header) {
      envIndent = header[1].length;
      continue;
    }
    if (envIndent === null) continue;
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }
    const list = line.trim().match(/^-\s*([A-Za-z_][A-Za-z0-9_]*)(?:=|\s|$)/);
    const map = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    const key = list?.[1] ?? map?.[1];
    if (key) envNames.push(key);
  }
  return { images, envNames };
}

/**
 * Replace secret-looking env values and the compose salt.
 * Returns the removed values only so the caller can assert they are gone,
 * and the caller must not write those values to disk or logs.
 */
export function redactAppCompose(raw: string): { redacted: string; removed: string[] } {
  const removed: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { redacted: redactDockerText(raw, removed), removed: uniqueLong(removed) };
  }
  if (!parsed || typeof parsed !== "object") {
    return { redacted: raw, removed: [] };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.docker_compose_file === "string") {
    obj.docker_compose_file = redactDockerText(obj.docker_compose_file, removed);
  }
  if (typeof obj.salt === "string" && obj.salt.length > 0) {
    removed.push(obj.salt);
    obj.salt = "REDACTED";
  }
  const dockerConfig = obj.docker_config;
  if (dockerConfig && typeof dockerConfig === "object") {
    const password = (dockerConfig as { password?: unknown }).password;
    if (typeof password === "string" && password.length > 0) {
      removed.push(password);
      (dockerConfig as { password: string }).password = "REDACTED";
    }
  }
  walkSecrets(obj, removed);
  const redacted = JSON.stringify(obj);
  const leaked = uniqueLong(removed).filter((value) => redacted.includes(value));
  if (leaked.length > 0) {
    throw new Error(
      `Redaction left ${leaked.length} secret-looking value(s) in the compose. The fixture was not written.`,
    );
  }
  return { redacted, removed: uniqueLong(removed) };
}

function redactDockerText(text: string, removed: string[]): string {
  const lines = text.split("\n");
  let envIndent: number | null = null;
  const next = lines.map((line) => {
    const header = line.match(/^(\s*)environment:\s*$/);
    if (header) {
      envIndent = header[1].length;
      return line;
    }
    if (envIndent === null) return line;
    if (!line.trim()) return line;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= envIndent) {
      envIndent = null;
      return line;
    }
    return redactEnvLine(line, removed);
  });
  return next.join("\n");
}

function redactEnvLine(line: string, removed: string[]): string {
  const list = line.match(/^(\s*-\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (list) {
    const [, pre, key, value] = list;
    if (shouldRedact(key, value)) {
      removed.push(unquote(value.trim()));
      return `${pre}${key}=REDACTED`;
    }
    return line;
  }
  const map = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:\s*)(.*)$/);
  if (map) {
    const [, pre, key, sep, value] = map;
    if (shouldRedact(key, value)) {
      removed.push(unquote(value.trim()));
      return `${pre}${key}${sep}REDACTED`;
    }
  }
  return line;
}

function shouldRedact(key: string, value: string): boolean {
  const trimmed = value.trim();
  if (!isSecretEnvName(key)) return false;
  if (!trimmed || trimmed === "REDACTED" || trimmed === "null" || trimmed.includes("${")) return false;
  return true;
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function walkSecrets(value: unknown, removed: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkSecrets(item, removed);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" && isSecretEnvName(key) && child.length >= 8 && child !== "REDACTED" && !child.includes("${")) {
      removed.push(child);
      record[key] = "REDACTED";
      continue;
    }
    walkSecrets(child, removed);
  }
}

function uniqueLong(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length >= 8 && value !== "REDACTED"))];
}
