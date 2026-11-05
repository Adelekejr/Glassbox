import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import type { VerifierMetadata } from "../types.js";

/**
 * Pinned @phala/dcap-qvl build.
 * QE identity verification is mandatory since 0.3.9 (GHSA-796p-j2gh-9m2q).
 * JavaScript CRL authentication is present since 0.5.3 (GHSA-2cjj-h43h-m6xj).
 * Glassbox enforces TCB status itself: a status other than UpToDate is risky.
 */
export const DCAP_QVL_VERSION = "0.7.1";
export const DCAP_QVL_QE_IDENTITY_FIX = "0.3.9";

/** Base URLs that may be passed to the collateral fetcher. Callers cannot choose one. */
export const PCCS_ALLOWLIST = [
  "https://pccs.phala.network",
  "https://api.trustedservices.intel.com",
] as const;

/** The only base URL Glassbox passes to getCollateral. */
export const PINNED_PCCS_URL = "https://pccs.phala.network";

/**
 * Hosts a collateral fetch may contact. The Intel certificate host is here so a
 * root CRL named by an Intel certificate can be fetched. Any other host is refused.
 */
export const COLLATERAL_HOSTS = [
  "pccs.phala.network",
  "api.trustedservices.intel.com",
  "certificates.trustedservices.intel.com",
] as const;

const COLLATERAL_HOST_SET = new Set<string>(COLLATERAL_HOSTS);

type GuardMode = "off" | "allowlist" | "block-all";

const guardStore = new AsyncLocalStorage<GuardMode>();
let fetchPatched = false;

export function compareVersions(left: string, right: string): number {
  const parse = (version: string) => version.split(".").map((part) => Number(part.replace(/[^\d].*$/, "")));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

export function qeIdentityMandatory(version: string = resolvedDcapQvlVersion()): boolean {
  return compareVersions(version, DCAP_QVL_QE_IDENTITY_FIX) >= 0;
}

export function resolvedDcapQvlVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@phala/dcap-qvl/package.json") as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // A bundled server may not resolve package.json. The pin below is what tests lock.
  }
  return DCAP_QVL_VERSION;
}

export function verifierMetadata(): VerifierMetadata {
  const version = resolvedDcapQvlVersion();
  return {
    package: "@phala/dcap-qvl",
    version,
    qeIdentity: qeIdentityMandatory(version) ? "mandatory" : "not-mandatory",
    tcbStatus: "enforced",
    pccsAllowlist: [...PCCS_ALLOWLIST, "https://certificates.trustedservices.intel.com"],
  };
}

export function collateralUrlAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  return COLLATERAL_HOST_SET.has(url.hostname);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Install once, before @phala/dcap-qvl captures global fetch.
 * Outside a collateral guard, fetch is unchanged. Inside it, only allowlisted
 * https hosts are contacted, and redirects are refused.
 */
export function installCollateralFetchGuard(): void {
  if (fetchPatched) return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const mode = guardStore.getStore() ?? "off";
    if (mode === "off") return original(input, init);
    const url = requestUrl(input);
    if (mode === "block-all" || !collateralUrlAllowed(url)) {
      throw new Error("Collateral fetch URL is not on the allowlist.");
    }
    return original(input, { ...init, redirect: "error" });
  };
  fetchPatched = true;
}

export function withCollateralGuard<T>(run: () => Promise<T>): Promise<T> {
  installCollateralFetchGuard();
  return guardStore.run("allowlist", run);
}

/** Test hook: the library's own fetch must throw before any network call. */
export function withBlockedCollateralFetch<T>(run: () => Promise<T>): Promise<T> {
  installCollateralFetchGuard();
  return guardStore.run("block-all", run);
}

installCollateralFetchGuard();
