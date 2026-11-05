import { createHash } from "node:crypto";
import type { ComposeFacts, ImageRef, SecretHit } from "../types.js";

/**
 * Names that look like key material in an app compose.
 * PUBLIC_* names are not flagged unless they also match a private marker.
 * API_CODEHASH is not an API key. ACCESS_KEY matches AWS_ACCESS_KEY_ID.
 */
export function isSecretEnvName(name: string): boolean {
  if (/API_CODEHASH/i.test(name)) return false;
  if (/^PUBLIC_/i.test(name) && !/PRIVATE|SECRET|SEED|MNEMONIC|API_KEY|ACCESS_KEY|PASSWORD/i.test(name)) {
    return false;
  }
  return (
    /PRIVATE_KEY|API_KEY|ACCESS_KEY|SEED|MNEMONIC|SECRET|PASSWORD/i.test(name) || /(^|_)TOKEN($|_)/i.test(name)
  );
}

export function isDebugImage(image: ImageRef): boolean {
  const tag = (image.tag ?? "").toLowerCase();
  if (tag === "debug" || tag === "dev" || tag === "dbg" || tag === "devel" || tag === "development") return true;
  const name = image.ref.toLowerCase().split("@")[0] ?? "";
  return /(^|[/:._-])(debug|dbg)([/:._-]|$)/.test(name) || /(^|[/:._-])dev([/:._-]|$)/.test(name);
}

const SOCKET_NAMES = ["docker.sock", "tappd.sock", "dstack.sock"] as const;

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
  const secrets: SecretHit[] = [];
  const envNames = new Set<string>();
  const images: ImageRef[] = [];
  const socketMounts: string[] = [];
  extractDocker(scanText, secrets, envNames, images, socketMounts);
  collectEnvContainer(obj?.env, "env", secrets, envNames);
  collectEnvContainer(obj?.environment, "environment", secrets, envNames);
  collectEnvContainer(tee?.env, "tee_config.env", secrets, envNames);
  if (obj) walkEnvObjects(obj, "", secrets, envNames);
  if (typeof obj?.pre_launch_script === "string") scanScript(obj.pre_launch_script, "pre_launch_script", secrets, envNames);
  if (typeof obj?.bash_script === "string") scanScript(obj.bash_script, "bash_script", secrets, envNames);
  collectSocketValues(obj?.volumes, "volumes", socketMounts);
  collectSocketValues(obj?.devices, "devices", socketMounts);
  if (obj && typeof obj.services === "object") walkServices(obj.services, socketMounts, secrets, envNames, images);
  const allowedEnvs = readAllowedEnvs(obj?.allowed_envs) ?? yamlList(text, "allowed_envs");
  const declared = firstString(obj?.dstack_version, tee?.dstack_version) ?? yamlScalar(text, "dstack_version");
  const publicLogs = firstBool(obj?.public_logs, tee?.public_logs) ?? yamlBool(text, "public_logs");
  const publicSysinfo = firstBool(obj?.public_sysinfo, tee?.public_sysinfo) ?? yamlBool(text, "public_sysinfo");
  const kmsEnabled = firstBool(obj?.kms_enabled, tee?.kms_enabled) ?? yamlBool(text, "kms_enabled");
  const hasEncryptedEnv = encryptedPresent(obj) || yamlKeyPresent(text, "encrypted_env") || yamlKeyPresent(text, "encrypted_environment");
  if (!obj && !scanText.trim()) return null;
  return {
    publicLogs,
    publicSysinfo,
    kmsEnabled,
    hasEncryptedEnv,
    allowedEnvs,
    dstackVersion: declared,
    versionDeclared: Boolean(declared),
    envNames: [...envNames],
    secrets: dedupeSecrets(secrets),
    images,
    socketMounts: [...new Set(socketMounts)],
    referencesTappdSocket: scanText.includes("tappd.sock"),
    hasDockerCompose: Boolean(docker.trim()) || /^\s*services:/m.test(text) || images.length > 0,
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

function collectEnvContainer(value: unknown, path: string, secrets: SecretHit[], names: Set<string>): void {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string") recordAssignment(item, `${path}[${index}]`, secrets, names);
    });
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (typeof child === "string") recordEnv(key, child, `${path}.${key}`, secrets, names);
      else recordEnv(key, undefined, `${path}.${key}`, secrets, names);
    }
  }
}

function walkEnvObjects(value: unknown, path: string, secrets: SecretHit[], names: Set<string>): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (key === "docker_compose_file" || key === "dockerCompose" || key === "pre_launch_script" || key === "bash_script") {
      continue;
    }
    if (key === "allowed_envs" || key === "salt" || key === "encrypted_env" || key === "encrypted_environment") continue;
    const next = path ? `${path}.${key}` : key;
    if (typeof child === "string" && isSecretEnvName(key)) {
      if (!child.trim()) continue;
      recordEnv(key, child, next, secrets, names);
      continue;
    }
    if (child && typeof child === "object") walkEnvObjects(child, next, secrets, names);
  }
}

function walkServices(
  services: unknown,
  sockets: string[],
  secrets: SecretHit[],
  names: Set<string>,
  images: ImageRef[],
): void {
  if (!services || typeof services !== "object") return;
  for (const [service, spec] of Object.entries(services as Record<string, unknown>)) {
    if (!spec || typeof spec !== "object") continue;
    const record = spec as Record<string, unknown>;
    if (typeof record.image === "string") images.push(classifyImage(record.image));
    collectEnvContainer(record.environment, `services.${service}.environment`, secrets, names);
    collectEnvContainer(record.env, `services.${service}.env`, secrets, names);
    collectSocketValues(record.volumes, `services.${service}.volumes`, sockets);
    collectSocketValues(record.devices, `services.${service}.devices`, sockets);
  }
}

function recordAssignment(item: string, path: string, secrets: SecretHit[], names: Set<string>): void {
  const match = item.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/);
  if (!match) return;
  recordEnv(match[1], match[2], path, secrets, names);
}

function recordEnv(name: string, rawValue: string | undefined, path: string, secrets: SecretHit[], names: Set<string>): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
  names.add(name);
  if (!isSecretEnvName(name)) return;
  secrets.push(classifySecret(name, rawValue, path));
}

function classifySecret(name: string, rawValue: string | undefined, path: string): SecretHit {
  if (rawValue === undefined) return { name, path, kind: "name" };
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "null" || trimmed === "REDACTED" || trimmed.includes("${")) {
    return { name, path, kind: "reference" };
  }
  const value = unquote(trimmed);
  if (!value || value.startsWith("$") || value === "REDACTED") return { name, path, kind: "reference" };
  const hashPrefix = sha256Hex(value).slice(0, 4);
  return { name, path, kind: "plaintext", hashPrefix };
}

function scanScript(script: string, path: string, secrets: SecretHit[], names: Set<string>): void {
  for (const line of script.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    recordEnv(match[1], match[2], path, secrets, names);
  }
}

function collectSocketValues(value: unknown, path: string, into: string[]): void {
  if (typeof value === "string") pushSockets(value, path, into);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") pushSockets(item, path, into);
    }
  }
}

function pushSockets(text: string, path: string, into: string[]): void {
  for (const name of SOCKET_NAMES) {
    if (!text.includes(name)) continue;
    const full = text.includes(`/var/run/${name}`) ? `/var/run/${name}` : name;
    into.push(`${path}: ${full}`);
  }
}

function readAllowedEnvs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function encryptedPresent(obj: Record<string, unknown> | null): boolean {
  if (!obj) return false;
  for (const key of ["encrypted_env", "encrypted_environment", "encryptedEnv"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0 && value.trim() !== "null") return true;
    if (Array.isArray(value) && value.length > 0) return true;
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) return true;
  }
  return false;
}

function yamlKeyPresent(text: string, key: string): boolean {
  return new RegExp(`^\\s*${key}\\s*:\\s*\\S`, "m").test(text);
}

function yamlList(text: string, key: string): string[] | null {
  const lines = text.split(/\r?\n/);
  let indent: number | null = null;
  const items: string[] = [];
  let seen = false;
  for (const line of lines) {
    if (indent === null) {
      const inline = line.match(new RegExp(`^\\s*${key}\\s*:\\s*\\[(.*)\\]\\s*$`));
      if (inline) {
        return inline[1]
          .split(",")
          .map((item) => unquote(item.trim()))
          .filter(Boolean);
      }
      const header = line.match(new RegExp(`^(\\s*)${key}\\s*:\\s*$`));
      if (header) {
        seen = true;
        indent = header[1].length;
      }
      continue;
    }
    if (!line.trim()) continue;
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
    if (lineIndent <= indent) break;
    const item = line.trim().match(/^-\s*(.+)$/);
    if (item) items.push(unquote(item[1].trim()));
  }
  return seen ? items : null;
}

function dedupeSecrets(secrets: SecretHit[]): SecretHit[] {
  const seen = new Set<string>();
  const out: SecretHit[] = [];
  for (const hit of secrets) {
    const key = `${hit.name}\0${hit.path}\0${hit.kind}\0${hit.hashPrefix ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function extractDocker(
  text: string,
  secrets: SecretHit[],
  envNames: Set<string>,
  images: ImageRef[],
  sockets: string[],
): void {
  if (!text) return;
  const lines = text.split(/\r?\n/);
  let envIndent: number | null = null;
  let volumeIndent: number | null = null;
  let volumePath = "docker_compose_file volumes";
  for (const line of lines) {
    const image = line.match(/^\s*image:\s*["']?(\S+?)["']?\s*$/);
    if (image) {
      images.push(classifyImage(image[1]));
      envIndent = null;
      volumeIndent = null;
      continue;
    }
    const volumeHeader = line.match(/^(\s*)(volumes|devices):\s*$/);
    if (volumeHeader) {
      volumeIndent = volumeHeader[1].length;
      volumePath = `docker_compose_file ${volumeHeader[2]}`;
      envIndent = null;
      continue;
    }
    const header = line.match(/^(\s*)environment:\s*$/);
    if (header) {
      envIndent = header[1].length;
      volumeIndent = null;
      continue;
    }
    if (volumeIndent !== null) {
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= volumeIndent) volumeIndent = null;
      else pushSockets(line, volumePath, sockets);
    }
    if (envIndent === null) continue;
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }
    const list = line.trim().match(/^-\s*([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/);
    if (list) {
      recordEnv(list[1], list[2], "docker_compose_file environment", secrets, envNames);
      continue;
    }
    const map = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (map) recordEnv(map[1], map[2], "docker_compose_file environment", secrets, envNames);
  }
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
