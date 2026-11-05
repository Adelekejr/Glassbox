import { existsSync, readFileSync } from "node:fs";
import { MPC_TARGETS } from "./checks/mpc.js";
import { fetchFreshCollateral } from "./checks/tdx.js";
import { parseCompose, sha256Hex } from "./evidence/compose.js";
import {
  approvalEventsFromCalls,
  approvalMethodsFor,
  normalizeMeasurementRow,
  normalizeV2Agent,
} from "./evidence/measurements.js";
import { normalizeRegistrationArgs, normalizeTcb } from "./evidence/registration.js";
import { AccountNotFoundError } from "./near/errors.js";
import { extractFunctionCallArgs, listMethodCalls, type HistoryCall } from "./near/history.js";
import { NearClient, methodExists } from "./near/rpc.js";
import { buildReport } from "./report.js";
import {
  detectNetwork,
  nsToSeconds,
  type AccessKeyView,
  type AgentView,
  type ApprovalEvent,
  type ApprovedCodehash,
  type ApprovedMeasurementRow,
  type EvidenceBundle,
  type MpcAllowlist,
  type Network,
  type RegistrationEvidence,
  type Report,
  type ShadeKind,
  type ShadeV2Agent,
} from "./types.js";

export interface AuditOptions {
  network?: Network;
  now?: Date;
  fetch?: typeof fetch;
  /** Use these JSON-RPC URLs instead of the public FastNEAR / near.org list. */
  rpcEndpoints?: string[];
  /** Skip the fresh PCCS fetch. Chain reads still happen. */
  skipFreshCollateral?: boolean;
  /** Skip NearBlocks approve/remove and registration history. */
  skipHistory?: boolean;
  /** Skip the public MPC allowlist reads. */
  skipMpc?: boolean;
  /** Defaults to final. Tests against a local sandbox may use optimistic. */
  finality?: "final" | "optimistic";
  nearblocksIntervalMs?: number;
  rpcIntervalMs?: number;
}

const PROBE_METHODS = [
  "get_contract_info",
  "get_approved_measurements",
  "get_approved_ppids",
  "get_agents",
  "get_agent",
  "get_worker",
  "allowed_docker_image_hashes",
] as const;

export async function auditAccount(accountId: string, options: AuditOptions = {}): Promise<Report> {
  const explicit = options.network ?? detectNetwork(accountId);
  const networks: Network[] = explicit ? [explicit] : ["mainnet", "testnet"];
  let lastNotFound: AccountNotFoundError | null = null;
  for (const network of networks) {
    try {
      const bundle = await collectAccount(accountId, network, options);
      return buildReport(bundle, { now: options.now });
    } catch (error) {
      if (error instanceof AccountNotFoundError && !options.network && !detectNetwork(accountId)) {
        lastNotFound = error;
        continue;
      }
      throw error;
    }
  }
  throw lastNotFound ?? new AccountNotFoundError(accountId, networks[0] ?? "mainnet");
}

export async function auditFile(path: string, options: AuditOptions = {}): Promise<Report> {
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return buildReport(bundleFromLooseText(path, text), { now: options.now });
  }
  return auditValue(parsed, { ...options, label: path });
}

export async function auditTarget(target: string, options: AuditOptions = {}): Promise<Report> {
  const trimmed = target.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return auditValue(JSON.parse(trimmed) as unknown, { ...options, label: "pasted-json" });
  }
  if (existsSync(trimmed)) return auditFile(trimmed, options);
  return auditAccount(trimmed, options);
}

export async function auditValue(value: unknown, options: AuditOptions & { label?: string } = {}): Promise<Report> {
  const bundle = bundleFromJson(value, options.label ?? "pasted-json");
  return buildReport(bundle, { now: options.now });
}

async function collectAccount(accountId: string, network: Network, options: AuditOptions): Promise<EvidenceBundle> {
  const client = new NearClient({
    network,
    fetch: options.fetch,
    minIntervalMs: options.rpcIntervalMs,
    endpoints: options.rpcEndpoints,
    finality: options.finality,
  });
  const archival = new NearClient({
    network,
    archival: !options.rpcEndpoints,
    fetch: options.fetch,
    minIntervalMs: options.rpcIntervalMs ?? (options.rpcEndpoints ? 50 : 1000),
    endpoints: options.rpcEndpoints,
    finality: options.finality,
  });
  const account = await client.viewAccount(accountId);
  const probes = await Promise.all(
    PROBE_METHODS.map(async (method) => {
      const view = await client.viewFunction(accountId, method, {});
      return [method, view] as const;
    }),
  );
  const probeMap = new Map(probes);
  const present = probes.filter(([, view]) => methodExists(view)).map(([method]) => method);
  const shade = classifyShade(new Set(present));
  const generatedAt = (options.now ?? new Date()).toISOString();

  let registration: RegistrationEvidence | null = null;
  let registrationCount = 0;
  let failedRegistrationCount = 0;
  let historySource: EvidenceBundle["historySource"] = "none";
  let agentView: AgentView | null = null;
  let approvedCodehashes: ApprovedCodehash[] = [];
  let approveCodehashCalls: HistoryCall[] = [];
  let approvedMeasurements: ApprovedMeasurementRow[] | undefined;
  let v2Agents: ShadeV2Agent[] | undefined;
  let requiresTee: boolean | null = null;
  const usedNearblocks = { value: false };

  let historyError: string | undefined;
  if (!options.skipHistory && (shade === "shade-v1" || shade === "shade-v1-worker" || shade === "shade-v2" || shade === "unknown")) {
    const method = shade === "shade-v1-worker" ? "register_worker" : "register_agent";
    const history = await safeHistory(network, accountId, method, options);
    historySource = history.source;
    usedNearblocks.value = history.usedNearblocks;
    historyError = history.error;
    registrationCount = history.calls.filter((call) => call.success).length;
    failedRegistrationCount = history.calls.filter((call) => !call.success).length;
    const chosen = history.calls.find((call) => call.success) ?? null;
    if (chosen) {
      registration = await loadRegistration(archival, network, chosen);
    }
  }

  if (!options.skipHistory && (shade === "shade-v1" || shade === "shade-v1-worker")) {
    const history = await safeHistory(network, accountId, "approve_codehash", options);
    if (history.usedNearblocks) usedNearblocks.value = true;
    if (historySource === "none") historySource = history.source;
    historyError = history.error ?? historyError;
    approveCodehashCalls = history.calls;
    approvedCodehashes = codehashesFrom(history.calls);
  }

  const infoView = probeMap.get("get_contract_info");
  if (infoView?.ok && infoView.value && typeof infoView.value === "object") {
    requiresTee = Boolean((infoView.value as { requires_tee?: boolean }).requires_tee);
  }
  const measurementView = probeMap.get("get_approved_measurements");
  if (measurementView?.ok && Array.isArray(measurementView.value)) {
    approvedMeasurements = measurementView.value
      .map((row) => normalizeMeasurementRow(row))
      .filter((row): row is ApprovedMeasurementRow => row !== null);
  }
  const agentsView = probeMap.get("get_agents");
  if (agentsView?.ok && Array.isArray(agentsView.value)) {
    v2Agents = agentsView.value
      .map((row) => normalizeV2Agent(row))
      .filter((row): row is ShadeV2Agent => row !== null);
  }

  const approvalHistory = options.skipHistory
    ? { events: [] as ApprovalEvent[], note: "Approval history was not requested." }
    : await collectApprovalHistory(shade, network, accountId, options, approveCodehashCalls, usedNearblocks, (message) => {
        historyError = message ?? historyError;
      });
  if (!options.skipHistory && usedNearblocks.value) historySource = "nearblocks";

  const agentId = registration?.agentId;
  if (present.includes("get_agent") && agentId) {
    const view = await client.viewFunction(accountId, "get_agent", { account_id: agentId });
    if (view.ok && view.value && typeof view.value === "object") {
      const record = view.value as AgentView;
      agentView = { checksum: record.checksum, codehash: record.codehash };
    }
  }

  let accessKeys: AccessKeyView[] | undefined;
  let accessKeyError: string | undefined;
  try {
    accessKeys = await client.accessKeys(accountId);
  } catch (error) {
    accessKeyError = error instanceof Error ? error.message : String(error);
  }

  const mpc = options.skipMpc ? [] : await readMpcAllowlists(options);
  const compose = registration?.tcbInfo?.app_compose ? parseCompose(registration.tcbInfo.app_compose) : null;

  let freshCollateral: unknown;
  let freshCollateralError: string | undefined;
  let collateralFetchedAt: string | undefined;
  if (registration?.quoteHex && !options.skipFreshCollateral) {
    try {
      freshCollateral = await fetchFreshCollateral(registration.quoteHex);
      collateralFetchedAt = (options.now ?? new Date()).toISOString();
    } catch (error) {
      freshCollateralError = error instanceof Error ? error.message : String(error);
    }
  }

  if (usedNearblocks.value) historySource = "nearblocks";
  let shadeDetail = describeShade(shade, present, account.global_contract_hash);
  if (requiresTee === false) {
    shadeDetail += " get_contract_info says requires_tee is false, so this registration path is Shade local mode, not a TEE.";
  } else if (requiresTee === true) {
    shadeDetail += " get_contract_info says requires_tee is true.";
  }

  return {
    target: accountId,
    network,
    shade,
    shadeDetail,
    codeHash: account.code_hash,
    globalContractHash: account.global_contract_hash ?? null,
    methodsPresent: present,
    registration,
    registrationCount,
    failedRegistrationCount,
    compose,
    agentView,
    v2Agents,
    requiresTee,
    approvedCodehashes,
    approvedMeasurements,
    approvalHistory: approvalHistory.events,
    approvalHistoryNote: approvalHistory.note,
    accessKeys,
    accessKeyError,
    mpc,
    freshCollateral,
    freshCollateralError,
    collateralFetchedAt,
    historySource,
    historyError,
    rpcEndpoints: [...client.endpointLog, ...archival.endpointLog],
    generatedAt,
  };
}

async function loadRegistration(
  archival: NearClient,
  network: Network,
  call: HistoryCall,
): Promise<RegistrationEvidence | null> {
  let args = call.args;
  let timestampSec = nsToSeconds(call.timestampNs);
  let blockHeight: number | undefined;
  try {
    const tx = await archival.transaction(call.hash, call.signer);
    const extracted = extractFunctionCallArgs(tx);
    if (extracted) args = extracted;
    const blockHash = (tx as { transaction_outcome?: { block_hash?: string } } | null)?.transaction_outcome?.block_hash;
    if (blockHash) {
      try {
        const block = await archival.block(blockHash);
        if (!timestampSec) timestampSec = nsToSeconds(block?.header?.timestamp);
        blockHeight = readBlockHeight(block?.header?.height);
      } catch {
        // The transaction body is enough when the block header is unavailable.
      }
    }
  } catch {
    // Indexer args, when complete, still let the quote check run.
  }
  const normalized = normalizeRegistrationArgs(args);
  if (!normalized) {
    return {
      agentId: call.signer,
      txHash: call.hash,
      timestampSec,
      blockHeight,
    };
  }
  return {
    quoteHex: normalized.quoteHex,
    collateral: normalized.collateral,
    checksum: normalized.checksum,
    tcbInfo: normalized.tcbInfo,
    appComposeSha256: normalized.appComposeSha256,
    appComposeRedacted: false,
    agentId: call.signer,
    txHash: call.hash,
    timestampSec,
    blockHeight,
  };
}

async function collectApprovalHistory(
  shade: ShadeKind,
  network: Network,
  accountId: string,
  options: AuditOptions,
  approveCodehashCalls: HistoryCall[],
  usedNearblocks: { value: boolean },
  onError: (message: string | undefined) => void,
): Promise<{ events: ApprovalEvent[]; note?: string }> {
  const events: ApprovalEvent[] = [];
  const notes: string[] = [];
  for (const method of approvalMethodsFor(shade)) {
    const page =
      method === "approve_codehash"
        ? { calls: approveCodehashCalls, usedNearblocks: false, error: undefined as string | undefined, fromCache: false }
        : await safeHistory(network, accountId, method, options);
    if (page.usedNearblocks) usedNearblocks.value = true;
    if (page.error) onError(page.error);
    if (page.fromCache) notes.push("Some rows were served from the local cache of an earlier NearBlocks read.");
    const rows = approvalEventsFromCalls(method, page.calls);
    events.push(...rows);
    if (rows.length === 0) notes.push(`No ${method} calls were in the indexed history.`);
  }
  events.sort((a, b) => (b.timestampNs ?? "").localeCompare(a.timestampNs ?? ""));
  return {
    events,
    note: notes.length ? [...new Set(notes)].join(" ") : undefined,
  };
}

async function safeHistory(
  network: Network,
  accountId: string,
  method: string,
  options: AuditOptions,
): Promise<{ calls: HistoryCall[]; source: "fastnear" | "nearblocks"; usedNearblocks: boolean; error?: string; fromCache?: boolean }> {
  try {
    return await listMethodCalls(network, accountId, method, {
      fetch: options.fetch,
      nearblocksIntervalMs: options.nearblocksIntervalMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      calls: [],
      source: "nearblocks",
      usedNearblocks: true,
      error: message,
    };
  }
}

function codehashesFrom(calls: HistoryCall[]): ApprovedCodehash[] {
  const rows: ApprovedCodehash[] = [];
  for (const call of calls) {
    if (!call.success || !call.args || typeof call.args !== "object") continue;
    const codehash = (call.args as { codehash?: unknown }).codehash;
    if (typeof codehash !== "string") continue;
    rows.push({ codehash, txHash: call.hash, signer: call.signer });
  }
  return rows;
}

async function readMpcAllowlists(options: AuditOptions): Promise<MpcAllowlist[]> {
  const lists: MpcAllowlist[] = [];
  for (const target of MPC_TARGETS) {
    const client = new NearClient({
      network: target.network,
      fetch: options.fetch,
      minIntervalMs: options.rpcIntervalMs,
    });
    try {
      const view = await client.viewFunction(target.accountId, "allowed_docker_image_hashes", {});
      if (!view.ok || !Array.isArray(view.value)) {
        lists.push({
          accountId: target.accountId,
          network: target.network,
          entries: [],
          error: view.message ?? "allowed_docker_image_hashes did not return a list",
        });
        continue;
      }
      lists.push({
        accountId: target.accountId,
        network: target.network,
        entries: (view.value as { image_hash?: string; expiry_timestamp_seconds?: number | null }[])
          .filter((entry) => typeof entry.image_hash === "string")
          .map((entry) => ({
            image_hash: entry.image_hash as string,
            expiry_timestamp_seconds: entry.expiry_timestamp_seconds ?? null,
          })),
      });
    } catch (error) {
      lists.push({
        accountId: target.accountId,
        network: target.network,
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return lists;
}

function readBlockHeight(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,16}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function classifyShade(present: Set<string>): ShadeKind {
  if (present.has("get_contract_info") || (present.has("get_approved_measurements") && present.has("get_agents"))) {
    return "shade-v2";
  }
  if (present.has("get_agent")) return "shade-v1";
  if (present.has("get_worker")) return "shade-v1-worker";
  if (present.has("get_approved_measurements")) return "measurements-registry";
  if (present.has("allowed_docker_image_hashes")) return "mpc-signer";
  return "unknown";
}

function describeShade(kind: ShadeKind, present: string[], globalHash?: string | null): string {
  const methods = present.length ? present.join(", ") : "no known view methods";
  const global = globalHash ? ` It uses global contract ${globalHash}.` : "";
  switch (kind) {
    case "shade-v2":
      return `View methods include a Shade v2 contract surface (${methods}).${global}`;
    case "shade-v1":
      return `View methods match Shade v1: get_agent is present and get_contract_info is not (${methods}). Shade v1 has no view that lists approved measurements.${global}`;
    case "shade-v1-worker":
      return `View methods match a Shade v1 worker proxy (${methods}).${global}`;
    case "measurements-registry":
      return `The account publishes get_approved_measurements and does not expose Shade v2's get_contract_info (${methods}).${global}`;
    case "mpc-signer":
      return `The account exposes allowed_docker_image_hashes (${methods}). This is the MPC docker allowlist, not a Shade agent contract.${global}`;
    default:
      return `The account did not expose Shade v1, Shade v2, an approved-measurements view, or allowed_docker_image_hashes (${methods}).${global}`;
  }
}

function bundleFromJson(value: unknown, label: string): EvidenceBundle {
  if (value && typeof value === "object" && (value as { kind?: string }).kind === "glassbox-capture") {
    return bundleFromCapture(value as CaptureFile, label);
  }
  const normalized = normalizeRegistrationArgs(value);
  if (normalized?.quoteHex || normalized?.tcbInfo) {
    const compose = normalized.tcbInfo?.app_compose ? parseCompose(normalized.tcbInfo.app_compose) : null;
    return baseBundle(label, {
      shade: "unknown",
      shadeDetail: "This file looks like Shade registration arguments (quote, collateral, or tcb_info). It was not read from chain in this run.",
      registration: {
        quoteHex: normalized.quoteHex,
        collateral: normalized.collateral,
        checksum: normalized.checksum,
        tcbInfo: normalized.tcbInfo,
        appComposeSha256: normalized.appComposeSha256,
        appComposeRedacted: false,
      },
      compose,
      historySource: "file",
    });
  }
  const tcb = normalizeTcb(value);
  const compose = parseCompose(value);
  if (tcb?.event_log || tcb?.mrtd || tcb?.os_image_hash) {
    return baseBundle(label, {
      shade: "unknown",
      shadeDetail: "This file looks like a tcb_info or attestation object. It was not read from chain in this run.",
      registration: { tcbInfo: tcb, appComposeSha256: tcb.app_compose ? sha256Hex(tcb.app_compose) : undefined },
      compose: tcb.app_compose ? parseCompose(tcb.app_compose) : compose,
      historySource: "file",
    });
  }
  if (compose) {
    return baseBundle(label, {
      shade: "unknown",
      shadeDetail: "This file looks like an app compose or a deployment description. It was not read from chain in this run.",
      registration: null,
      compose,
      historySource: "file",
    });
  }
  return baseBundle(label, {
    shade: "unknown",
    shadeDetail: "The JSON did not look like a registration, an app compose, or a deployment.",
    registration: null,
    compose: null,
    historySource: "file",
  });
}

interface CaptureFile {
  kind: "glassbox-capture";
  network?: Network;
  contractId: string;
  agentId?: string;
  txHash?: string;
  blockTimestampNs?: string;
  codeHash?: string;
  globalContractHash?: string | null;
  shade?: ShadeKind;
  agentView?: AgentView;
  approvedCodehashes?: ApprovedCodehash[];
  accessKeys?: AccessKeyView[];
  quoteHex?: string;
  collateral?: unknown;
  checksum?: string;
  tcbInfo?: ReturnType<typeof normalizeTcb>;
  originalAppComposeSha256?: string;
  mpcAllowlists?: MpcAllowlist[];
  appComposeRedacted?: boolean;
}

function bundleFromCapture(capture: CaptureFile, label: string): EvidenceBundle {
  const tcb = capture.tcbInfo ? normalizeTcb(capture.tcbInfo) ?? capture.tcbInfo : undefined;
  const compose = tcb?.app_compose ? parseCompose(tcb.app_compose) : null;
  return baseBundle(capture.contractId || label, {
    network: capture.network ?? "offline",
    shade: capture.shade ?? "shade-v1",
    shadeDetail:
      "Loaded from a Glassbox capture file. Chain state was not re-read. Secret-looking env values in the stored app compose were removed before the file was written.",
    codeHash: capture.codeHash,
    globalContractHash: capture.globalContractHash,
    registration: {
      quoteHex: capture.quoteHex,
      collateral: capture.collateral,
      checksum: capture.checksum,
      tcbInfo: tcb,
      appComposeSha256: capture.originalAppComposeSha256,
      appComposeRedacted: capture.appComposeRedacted === true,
      agentId: capture.agentId,
      txHash: capture.txHash,
      timestampSec: nsToSeconds(capture.blockTimestampNs),
    },
    compose,
    agentView: capture.agentView,
    approvedCodehashes: capture.approvedCodehashes,
    accessKeys: capture.accessKeys,
    mpc: capture.mpcAllowlists,
    mpcFromSnapshot: Boolean(capture.mpcAllowlists?.length),
    historySource: "file",
    methodsPresent: ["get_agent"],
  });
}

function bundleFromLooseText(label: string, text: string): EvidenceBundle {
  const compose = parseCompose(text);
  return baseBundle(label, {
    shade: "unknown",
    shadeDetail: "This file is not JSON. Glassbox scanned it as a deployment or compose text. It was not read from chain.",
    registration: null,
    compose,
    historySource: "file",
  });
}

function baseBundle(target: string, patch: Partial<EvidenceBundle> & Pick<EvidenceBundle, "shade" | "shadeDetail">): EvidenceBundle {
  return {
    target,
    network: "offline",
    methodsPresent: [],
    registration: null,
    compose: null,
    rpcEndpoints: [],
    generatedAt: new Date().toISOString(),
    historySource: "file",
    ...patch,
  };
}
