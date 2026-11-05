export type Network = "testnet" | "mainnet";
export type Ladder = "PROVEN" | "NOT_PROVEN" | "RISKY";

export type ShadeKind =
  | "shade-v1"
  | "shade-v1-worker"
  | "shade-v2"
  | "measurements-registry"
  | "mpc-signer"
  | "unknown";

export interface EvidenceLink {
  label: string;
  url?: string;
  detail?: string;
}

export interface Finding {
  id: string;
  ladder: Ladder;
  title: string;
  plainEnglish: string;
  /** True when the sentence goes beyond a direct equality or a signature check. */
  inference: boolean;
  evidence: EvidenceLink[];
}

export interface ApprovalEvent {
  method: string;
  kind: "approve" | "remove";
  txHash: string;
  signer: string;
  timestampNs?: string;
  timestampIso?: string;
  success: boolean;
  detail: string;
}

export interface VerifierMetadata {
  package: "@phala/dcap-qvl";
  version: string;
  qeIdentity: "mandatory" | "not-mandatory";
  tcbStatus: "enforced";
  pccsAllowlist: string[];
}

export interface Report {
  tool: "glassbox";
  version: string;
  /** Pinned quote verifier. QE identity and the PCCS allowlist are stated here, not only in prose. */
  verifier: VerifierMetadata;
  target: string;
  network: Network | "offline";
  shade: ShadeKind;
  generatedAt: string;
  summary: { proven: number; notProven: number; risky: number };
  /** Highest rung present. Counts stay on `summary`; this is not a separate check. */
  overall: Ladder;
  overallPlainEnglish: string;
  findings: Finding[];
  /** On-demand approve/remove calls for this one contract. Not a watcher. */
  approvalHistory: ApprovalEvent[];
  approvalHistoryNote?: string;
  limitations: string[];
  sources: string[];
  attribution: string[];
}

export interface EventLogEntry {
  imr: number;
  event_type?: number;
  digest: string;
  event?: string;
  event_payload?: string;
}

export interface TcbInfo {
  rootfs_hash?: string;
  mrtd?: string;
  rtmr0?: string;
  rtmr1?: string;
  rtmr2?: string;
  rtmr3?: string;
  event_log?: EventLogEntry[];
  app_compose?: string;
  os_image_hash?: string;
  compose_hash?: string;
  device_id?: string;
}

export interface Measurements {
  mrtd?: string;
  rtmr0?: string;
  rtmr1?: string;
  rtmr2?: string;
  rtmr3?: string;
}

export interface ImageRef {
  ref: string;
  pinned: boolean;
  digest: string | null;
  tag: string | null;
  implicitLatest: boolean;
}

/** A secret-looking env entry. Plaintext values are never stored; only a 4-hex sha256 prefix. */
export interface SecretHit {
  name: string;
  path: string;
  kind: "plaintext" | "reference" | "name";
  hashPrefix?: string;
}

export interface ComposeFacts {
  publicLogs: boolean | null;
  publicSysinfo: boolean | null;
  kmsEnabled: boolean | null;
  hasEncryptedEnv: boolean;
  /** null when the field is absent. */
  allowedEnvs: string[] | null;
  dstackVersion: string | null;
  /** True when the version was a field in the file, not inferred from measurements. */
  versionDeclared: boolean;
  envNames: string[];
  secrets: SecretHit[];
  images: ImageRef[];
  /** Volume or device paths that bind docker.sock, tappd.sock, or dstack.sock into an app. */
  socketMounts: string[];
  referencesTappdSocket: boolean;
  hasDockerCompose: boolean;
}

export interface AccessKeyView {
  public_key: string;
  access_key: {
    nonce?: number;
    permission:
      | "FullAccess"
      | {
          FunctionCall: {
            allowance: string | null;
            receiver_id: string;
            method_names: string[];
          };
        };
  };
}

export interface ApprovedCodehash {
  codehash: string;
  txHash?: string;
  signer?: string;
}

export interface AgentView {
  checksum?: string;
  codehash?: string;
}

export interface MpcHashEntry {
  image_hash: string;
  expiry_timestamp_seconds: number | null;
}

export interface MpcAllowlist {
  accountId: string;
  network: Network;
  entries: MpcHashEntry[];
  error?: string;
}

export interface ApprovedMeasurementRow {
  mrtd?: string;
  rtmr0?: string;
  rtmr1?: string;
  rtmr2?: string;
  rtmr3?: string;
  app_compose_hash_payload?: string;
  key_provider_event_digest?: string;
  ppid?: string;
}

export interface RegistrationEvidence {
  quoteHex?: string;
  collateral?: unknown;
  checksum?: string;
  tcbInfo?: TcbInfo;
  /** sha256 of the exact app_compose string that was hashed. */
  appComposeSha256?: string;
  /**
   * True when appComposeSha256 was computed from the on-chain string and the
   * string kept beside it has had secret-looking values removed.
   */
  appComposeRedacted?: boolean;
  agentId?: string;
  txHash?: string;
  timestampSec?: number;
}

export interface ShadeV2Agent {
  accountId: string;
  measurements: ApprovedMeasurementRow;
  ppid?: string;
  validUntilMs?: number;
  validity: string;
  valid: boolean;
}

export interface EvidenceBundle {
  target: string;
  network: Network | "offline";
  shade: ShadeKind;
  shadeDetail: string;
  codeHash?: string;
  globalContractHash?: string | null;
  methodsPresent: string[];
  registration: RegistrationEvidence | null;
  registrationCount?: number;
  failedRegistrationCount?: number;
  compose: ComposeFacts | null;
  agentView?: AgentView | null;
  v2Agents?: ShadeV2Agent[];
  requiresTee?: boolean | null;
  approvedCodehashes?: ApprovedCodehash[];
  codehashHistoryComplete?: boolean;
  approvedMeasurements?: ApprovedMeasurementRow[];
  approvalHistory?: ApprovalEvent[];
  approvalHistoryNote?: string;
  accessKeys?: AccessKeyView[];
  accessKeyError?: string;
  mpc?: MpcAllowlist[];
  mpcFromSnapshot?: boolean;
  freshCollateral?: unknown;
  freshCollateralError?: string;
  historySource?: "fastnear" | "nearblocks" | "none" | "file";
  historyError?: string;
  rpcEndpoints: string[];
  generatedAt: string;
}

export const PHALA_POSTMORTEM_URL =
  "https://phala.com/posts/2026-10-post-mortem-dstack-guest-agent-vulnerability";

export const MEASURE_REPO_URL = "https://github.com/dreyyyy1/measure";

export const GLASSBOX_VERSION = "0.2.0";

/** Phala's stated auto-upgrade / v0.3.x retirement boundary. */
export const AUTO_UPGRADE_AT = Date.parse("2026-11-20T00:00:00.000Z");

export function accountUrl(network: Network, accountId: string): string {
  const host = network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  return `${host}/address/${encodeURIComponent(accountId)}`;
}

export function txUrl(network: Network, hash: string): string {
  const host = network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  return `${host}/txns/${encodeURIComponent(hash)}`;
}

export function advisoryUrl(id: string): string {
  return `https://www.intel.com/content/www/us/en/security-center/advisory/${encodeURIComponent(id.toLowerCase())}.html`;
}

/** Date.parse / toISOString throw outside this range. Chain timestamps are untrusted. */
const MAX_DATE_MS = 8.64e15;

export function isoFromUnixMs(ms: number): string | undefined {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

export function detectNetwork(accountId: string): Network | null {
  const id = accountId.trim().toLowerCase();
  if (id.endsWith(".testnet")) return "testnet";
  if (id.endsWith(".near")) return "mainnet";
  return null;
}

function finiteSeconds(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

export function nsToSeconds(ns: string | number | bigint | undefined | null): number | undefined {
  if (ns === undefined || ns === null) return undefined;
  if (typeof ns === "bigint") return finiteSeconds(Number(ns / 1_000_000_000n));
  // Longer than this is not a real nanosecond timestamp and can be a memory sink.
  if (typeof ns === "string" && /^\d{1,20}$/.test(ns)) {
    return finiteSeconds(Number(BigInt(ns) / 1_000_000_000n));
  }
  if (typeof ns === "number" && Number.isFinite(ns)) {
    return finiteSeconds(Math.round(ns / 1e9));
  }
  return undefined;
}
