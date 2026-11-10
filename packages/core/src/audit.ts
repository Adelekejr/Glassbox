import { existsSync, readFileSync } from "node:fs";
import { CHANGE_METHOD_NAMES } from "./checks/contract.js";
import { probeLiveGuest, unattemptedLiveObservation } from "./checks/liveness.js";
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
import { EMPTY_CONTRACT_CODE_HASH } from "./data/shade-templates.js";
import { AccountNotFoundError } from "./near/errors.js";
import { extractFunctionCallArgs, formatHistoryCacheAge, listMethodCalls, type HistoryCall } from "./near/history.js";
import { NearClient, methodExists, type ViewResult } from "./near/rpc.js";
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
  type MethodProbe,
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
  /** Record anchor intent. Does not send a transaction. */
  anchorIntent?: boolean;
  /**
   * Optional https Phala guest URL. Off-allowlist values are not fetched.
   * Callers of the web and MCP paths must not set this from user JSON.
   */
  liveEndpoint?: string;
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

/** Probe detail for a host that compiled nothing. This is not MethodNotFound. */
const NO_CODE_DETAIL = "CodeDoesNotExist";

const NO_CONTRACT_CODE_SENTENCE = "No contract code is deployed on this account.";

export async function auditAccount(accountId: string, options: AuditOptions = {}): Promise<Report> {
  const explicit = options.network ?? detectNetwork(accountId);
  const networks: Network[] = explicit ? [explicit] : ["mainnet", "testnet"];
  let lastNotFound: AccountNotFoundError | null = null;
  for (const network of networks) {
    try {
      const bundle = await collectAccount(accountId, network, options);
      return buildReport(bundle, reportOptions(options));
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
    return buildReport(bundleFromLooseText(path, text), reportOptions(options));
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
  const label = options.label ?? "pasted-json";
  const bundle = bundleFromJson(value, label);
  bundle.inputOrigin = label === "pasted-json" ? "paste" : "file";
  return buildReport(bundle, reportOptions(options));
}

function reportOptions(options: AuditOptions): { now?: Date; anchorIntent?: boolean } {
  return { now: options.now, anchorIntent: options.anchorIntent };
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
  const noDeployedCode = accountHasNoDeployedCode(account);
  const probed = await Promise.all(
    PROBE_METHODS.map((method) => probeMethod(client, accountId, method, noDeployedCode)),
  );
  const noContractCode = noDeployedCode || interfaceShowsNoCode(probed);
  if (noContractCode) {
    for (const hit of probed) {
      if (hit.outcome === "present") {
        hit.outcome = "absent";
        hit.detail = NO_CODE_DETAIL;
      }
    }
  }
  const probeMap = new Map(probed.map((probe) => [probe.name, probe]));
  const methodProbes: MethodProbe[] = probed.map(({ name, outcome, detail }) => ({ name, outcome, detail }));
  const present = methodProbes.filter((probe) => probe.outcome === "present").map((probe) => probe.name);
  const shade = noContractCode ? "unknown" : classifyShade(methodProbes);
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

  const historyFailures: { method: string; detail: string }[] = [];
  let registrationCacheAgeMs: number | undefined;
  let codehashCacheAgeMs: number | undefined;
  let registrationArgsUnreadable = false;
  let codehashArgsUnreadable = false;
  let approveCodehashError: string | undefined;
  let approveCodehashFromCache = false;
  let approveCodehashCacheAgeMs: number | undefined;
  const noteHistoryFailure = (method: string, error?: string): void => {
    if (!error || historyFailures.some((failure) => failure.method === method)) return;
    historyFailures.push({ method, detail: error });
  };
  if (!options.skipHistory && (shade === "shade-v1" || shade === "shade-v1-worker" || shade === "shade-v2" || shade === "unknown")) {
    const method = shade === "shade-v1-worker" ? "register_worker" : "register_agent";
    const history = await safeHistory(network, accountId, method, options);
    if (!history.error && history.source !== "none") historySource = history.source;
    if (history.usedNearblocks) usedNearblocks.value = true;
    noteHistoryFailure(method, history.error);
    if (history.fromCache && history.cacheAgeMs !== undefined) registrationCacheAgeMs = history.cacheAgeMs;
    registrationCount = history.calls.filter((call) => call.success).length;
    failedRegistrationCount = history.calls.filter((call) => !call.success).length;
    const chosen = history.calls.find((call) => call.success) ?? null;
    if (chosen) {
      const loaded = await loadRegistration(archival, network, chosen);
      registration = loaded.evidence;
      registrationArgsUnreadable = loaded.argsUnreadable;
    }
  }

  if (!options.skipHistory && (shade === "shade-v1" || shade === "shade-v1-worker")) {
    const history = await safeHistory(network, accountId, "approve_codehash", options);
    if (history.usedNearblocks) usedNearblocks.value = true;
    if (!history.error && history.source !== "none" && historySource === "none") historySource = history.source;
    noteHistoryFailure("approve_codehash", history.error);
    approveCodehashError = history.error;
    approveCodehashFromCache = history.fromCache === true;
    approveCodehashCacheAgeMs = history.cacheAgeMs;
    if (history.fromCache && history.cacheAgeMs !== undefined) codehashCacheAgeMs = history.cacheAgeMs;
    approveCodehashCalls = history.calls;
    approvedCodehashes = codehashesFrom(history.calls);
    codehashArgsUnreadable = history.calls.some((call) => call.success && call.argsUnreadable === true);
  }

  const infoView = presentView(probeMap.get("get_contract_info"));
  let ownerId: string | undefined;
  let sawContractInfo = false;
  if (infoView?.ok && infoView.value && typeof infoView.value === "object") {
    const info = infoView.value as { requires_tee?: unknown; owner_id?: unknown; owner?: unknown; ownerId?: unknown };
    sawContractInfo = true;
    // A missing flag is unknown. Boolean(undefined) is false and must not become local mode.
    if (typeof info.requires_tee === "boolean") requiresTee = info.requires_tee;
    ownerId = readOwnerId(info);
  }
  const changeMethods: { name: string; exists: boolean }[] = [];
  for (const name of CHANGE_METHOD_NAMES) {
    try {
      const view = await client.viewFunction(accountId, name, {});
      const settled = viewProbeOutcome(view, noContractCode);
      if (settled.detail === NO_CODE_DETAIL) {
        // No code is not MethodNotFound. Do not record exists:false, which would prove the name absent.
        methodProbes.push({ name, outcome: "absent", detail: NO_CODE_DETAIL });
        continue;
      }
      const exists = settled.outcome === "present";
      changeMethods.push({ name, exists });
      methodProbes.push({ name, outcome: settled.outcome, detail: exists ? undefined : settled.detail });
    } catch (error) {
      // An RPC failure is not MethodNotFound. Leave the method unprobed.
      methodProbes.push({ name, outcome: "unavailable", detail: transportDetail(error) });
    }
  }
  const measurementView = presentView(probeMap.get("get_approved_measurements"));
  if (measurementView?.ok && Array.isArray(measurementView.value)) {
    approvedMeasurements = measurementView.value
      .map((row) => normalizeMeasurementRow(row))
      .filter((row): row is ApprovedMeasurementRow => row !== null);
  }
  const agentsView = presentView(probeMap.get("get_agents"));
  if (agentsView?.ok && Array.isArray(agentsView.value)) {
    v2Agents = agentsView.value
      .map((row) => normalizeV2Agent(row))
      .filter((row): row is ShadeV2Agent => row !== null);
  }

  const approvalHistory = options.skipHistory
    ? { events: [] as ApprovalEvent[], note: "Approval history was not requested." }
    : await collectApprovalHistory(
        shade,
        network,
        accountId,
        options,
        {
          calls: approveCodehashCalls,
          error: approveCodehashError,
          fromCache: approveCodehashFromCache,
          cacheAgeMs: approveCodehashCacheAgeMs,
        },
        usedNearblocks,
        noteHistoryFailure,
      );
  if (!options.skipHistory && usedNearblocks.value) historySource = "nearblocks";
  const historyError = formatHistoryFailures(historyFailures);
  const historyFailedMethods = historyFailures.map((failure) => failure.method);

  const agentId = registration?.agentId;
  let agentViewError: string | undefined;
  if (present.includes("get_agent") && agentId) {
    try {
      const view = await client.viewFunction(accountId, "get_agent", { account_id: agentId });
      if (view.ok && view.value && typeof view.value === "object") {
        const record = view.value as AgentView;
        agentView = { checksum: record.checksum, codehash: record.codehash };
      }
    } catch (error) {
      agentViewError = transportDetail(error);
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
  let shadeDetail = describeShade(shade, methodProbes, account.global_contract_hash);
  if (shade === "shade-v2" && requiresTee === false) {
    shadeDetail += " get_contract_info says requires_tee is false, so this registration path is Shade local mode, not a TEE.";
  } else if (shade === "shade-v2" && requiresTee === true) {
    shadeDetail += " get_contract_info says requires_tee is true.";
  } else if (shade === "shade-v2" && sawContractInfo && requiresTee === null) {
    shadeDetail += " get_contract_info did not include requires_tee, so Shade local mode was not proven.";
  }
  if (noContractCode) shadeDetail = NO_CONTRACT_CODE_SENTENCE;

  const live = options.liveEndpoint
    ? await probeLiveGuest(options.liveEndpoint, options.fetch)
    : unattemptedLiveObservation();

  return {
    target: accountId,
    network,
    shade,
    shadeDetail,
    codeHash: account.code_hash,
    globalContractHash: account.global_contract_hash ?? null,
    ownerId,
    changeMethods: changeMethods.length > 0 ? changeMethods : undefined,
    live,
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
    historyFailedMethods: historyFailedMethods.length > 0 ? historyFailedMethods : undefined,
    historyError,
    registrationHistoryCacheAgeMs: registrationCacheAgeMs,
    codehashHistoryCacheAgeMs: codehashCacheAgeMs,
    registrationArgsUnreadable: registrationArgsUnreadable || undefined,
    codehashArgsUnreadable: codehashArgsUnreadable || undefined,
    inputOrigin: "chain",
    methodProbes,
    agentViewError,
    rpcEndpoints: [...client.endpointLog, ...archival.endpointLog],
    generatedAt,
  };
}

async function loadRegistration(
  archival: NearClient,
  network: Network,
  call: HistoryCall,
): Promise<{ evidence: RegistrationEvidence | null; argsUnreadable: boolean }> {
  let args = call.args;
  let timestampSec = nsToSeconds(call.timestampNs);
  let blockHeight: number | undefined;
  let argsUnreadable = call.argsUnreadable === true && args === undefined;
  try {
    const tx = await archival.transaction(call.hash, call.signer);
    const extracted = extractFunctionCallArgs(tx);
    if (extracted) {
      args = extracted;
      argsUnreadable = false;
    }
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
    if (args === undefined) argsUnreadable = true;
  }
  const normalized = normalizeRegistrationArgs(args);
  if (!normalized) {
    return {
      evidence: {
        agentId: call.signer,
        txHash: call.hash,
        timestampSec,
        blockHeight,
      },
      argsUnreadable,
    };
  }
  return {
    evidence: {
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
    },
    argsUnreadable: false,
  };
}

async function collectApprovalHistory(
  shade: ShadeKind,
  network: Network,
  accountId: string,
  options: AuditOptions,
  approveCodehash: { calls: HistoryCall[]; error?: string; fromCache: boolean; cacheAgeMs?: number },
  usedNearblocks: { value: boolean },
  onError: (method: string, error?: string) => void,
): Promise<{ events: ApprovalEvent[]; note?: string }> {
  const events: ApprovalEvent[] = [];
  const notes: string[] = [];
  for (const method of approvalMethodsFor(shade)) {
    const page =
      method === "approve_codehash"
        ? {
            calls: approveCodehash.calls,
            usedNearblocks: false,
            error: approveCodehash.error,
            fromCache: approveCodehash.fromCache,
            cacheAgeMs: approveCodehash.cacheAgeMs,
            source: "none" as const,
          }
        : await safeHistory(network, accountId, method, options);
    if (page.usedNearblocks) usedNearblocks.value = true;
    if (page.error) {
      onError(method, page.error);
      notes.push(`Could not read ${method} history (${page.error}).`);
    } else if (page.fromCache) {
      const age = page.cacheAgeMs !== undefined ? ` (${formatHistoryCacheAge(page.cacheAgeMs)} old)` : "";
      notes.push(`Some ${method} rows were served from a local cache of an earlier history read${age}.`);
    }
    const rows = approvalEventsFromCalls(method, page.calls);
    events.push(...rows);
    if (!page.error && rows.length === 0) notes.push(`No ${method} calls were in the indexed history.`);
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
): Promise<{
  calls: HistoryCall[];
  source: "fastnear" | "nearblocks" | "none";
  usedNearblocks: boolean;
  error?: string;
  fromCache?: boolean;
  cacheAgeMs?: number;
}> {
  try {
    return await listMethodCalls(network, accountId, method, {
      fetch: options.fetch,
      nearblocksIntervalMs: options.nearblocksIntervalMs,
      rpcIntervalMs: options.rpcIntervalMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      calls: [],
      source: "none",
      usedNearblocks: false,
      error: message,
    };
  }
}

function formatHistoryFailures(failures: { method: string; detail: string }[]): string | undefined {
  if (failures.length === 0) return undefined;
  const parts = failures.map((failure) => `${failure.method} (${failure.detail})`);
  return `Could not read history for ${parts.join("; ")}.`;
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

function readOwnerId(value: { owner_id?: unknown; owner?: unknown; ownerId?: unknown }): string | undefined {
  for (const candidate of [value.owner_id, value.owner, value.ownerId]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function readBlockHeight(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,16}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function classifyShade(probes: MethodProbe[]): ShadeKind {
  const probe = (name: string) => probes.find((item) => item.name === name);
  const present = (name: string) => probe(name)?.outcome === "present";
  // Absence is MethodNotFound only. CodeDoesNotExist is not a missing name, and a failed probe must not select an interface that depends on that method being missing.
  const absent = (name: string) => {
    const item = probe(name);
    return item?.outcome === "absent" && item.detail !== NO_CODE_DETAIL;
  };
  // get_contract_info by itself is not Shade v2. The v2 views have to answer.
  const shadeV2View =
    present("get_approved_measurements") || present("get_agents") || present("get_approved_ppids");
  if ((present("get_contract_info") && shadeV2View) || (present("get_approved_measurements") && present("get_agents"))) {
    return "shade-v2";
  }
  if (present("get_agent") && absent("get_contract_info")) return "shade-v1";
  if (present("get_worker") && absent("get_agent") && absent("get_contract_info")) return "shade-v1-worker";
  if (present("get_approved_measurements") && absent("get_contract_info")) return "measurements-registry";
  if (
    present("allowed_docker_image_hashes") &&
    absent("get_agent") &&
    absent("get_worker") &&
    absent("get_contract_info") &&
    absent("get_approved_measurements") &&
    absent("get_agents")
  ) {
    return "mpc-signer";
  }
  return "unknown";
}

function describeShade(kind: ShadeKind, probes: MethodProbe[], globalHash?: string | null): string {
  const views = probes.filter((probe) => (PROBE_METHODS as readonly string[]).includes(probe.name));
  const present = views.filter((probe) => probe.outcome === "present").map((probe) => probe.name);
  const absent = views
    .filter((probe) => probe.outcome === "absent" && probe.detail !== NO_CODE_DETAIL)
    .map((probe) => probe.name);
  const unavailable = views.filter((probe) => probe.outcome === "unavailable").map((probe) => probe.name);
  const methods = present.length ? present.join(", ") : "no known view methods";
  const global = globalHash ? ` It uses global contract ${globalHash}.` : "";
  const unavailableNote = unavailable.length
    ? ` These probes failed and were not treated as absent: ${unavailable.join(", ")}.`
    : "";
  switch (kind) {
    case "shade-v2":
      return `View methods include a Shade v2 contract surface (${methods}).${global}${unavailableNote}`;
    case "shade-v1":
      return `View methods match Shade v1: get_agent is present and get_contract_info is not (${methods}). Shade v1 has no view that lists approved measurements.${global}${unavailableNote}`;
    case "shade-v1-worker":
      return `View methods match a Shade v1 worker proxy (${methods}).${global}${unavailableNote}`;
    case "measurements-registry":
      return `The account publishes get_approved_measurements and does not expose Shade v2's get_contract_info (${methods}).${global}${unavailableNote}`;
    case "mpc-signer":
      return `The account exposes allowed_docker_image_hashes (${methods}). This is the MPC docker allowlist, not a Shade agent contract.${global}${unavailableNote}`;
    default:
      if (unavailable.length > 0) {
        return `The interface was not classified because some probes did not answer (${unavailable.join(", ")}). A transport failure is not MethodNotFound. Methods that answered: ${present.join(", ") || "none"}. Methods the host reported as missing: ${absent.join(", ") || "none"}.${global}`;
      }
      return `The account did not expose Shade v1, Shade v2, an approved-measurements view, or allowed_docker_image_hashes (${methods}).${global}`;
  }
}

interface ProbeHit {
  name: string;
  outcome: MethodProbe["outcome"];
  detail?: string;
  view?: ViewResult;
}

async function probeMethod(
  client: NearClient,
  accountId: string,
  method: string,
  noDeployedCode: boolean,
): Promise<ProbeHit> {
  try {
    const view = await client.viewFunction(accountId, method, {});
    const settled = viewProbeOutcome(view, noDeployedCode);
    return { name: method, outcome: settled.outcome, detail: settled.detail, view };
  } catch (error) {
    return { name: method, outcome: "unavailable", detail: transportDetail(error) };
  }
}

function viewProbeOutcome(
  view: ViewResult,
  noDeployedCode: boolean,
): { outcome: "present" | "absent"; detail?: string } {
  if (noDeployedCode || view.reason === "code_does_not_exist") {
    return { outcome: "absent", detail: NO_CODE_DETAIL };
  }
  if (methodExists(view)) return { outcome: "present" };
  return { outcome: "absent", detail: "MethodNotFound" };
}

function presentView(hit: ProbeHit | undefined): ViewResult | undefined {
  if (hit?.outcome !== "present") return undefined;
  return hit.view;
}

/**
 * The all-ones code hash is base58 of 32 zero bytes: no local wasm.
 * A global contract can still run when that hash is empty, so it stays deployed code.
 */
function accountHasNoDeployedCode(account: {
  code_hash?: string;
  global_contract_hash?: string | null;
}): boolean {
  const globalHash = account.global_contract_hash;
  if (typeof globalHash === "string" && globalHash.trim().length > 0) return false;
  if (typeof account.code_hash !== "string") return false;
  const codeHash = account.code_hash.trim();
  return codeHash.length === 0 || codeHash === EMPTY_CONTRACT_CODE_HASH;
}

function interfaceShowsNoCode(probes: ProbeHit[]): boolean {
  const iface = probes.filter((probe) => (PROBE_METHODS as readonly string[]).includes(probe.name));
  if (iface.length === 0) return false;
  if (iface.some((probe) => probe.outcome === "present" || probe.outcome === "unavailable")) return false;
  return iface.every((probe) => probe.detail === NO_CODE_DETAIL);
}

function transportDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cleaned = message.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const clipped = cleaned.length > 180 ? `${cleaned.slice(0, 180)}…` : cleaned;
  return `RPC failed. This is not MethodNotFound. ${clipped || "the call did not return"}`;
}

function bundleFromJson(value: unknown, label: string): EvidenceBundle {
  if (value && typeof value === "object" && (value as { kind?: string }).kind === "glassbox-capture") {
    return bundleFromCapture(value as CaptureFile, label);
  }
  const normalized = normalizeRegistrationArgs(value);
  if (normalized?.quoteHex || normalized?.tcbInfo) {
    const compose = normalized.tcbInfo?.app_compose ? parseCompose(normalized.tcbInfo.app_compose) : null;
    return withAttachedCodes(
      value,
      baseBundle(label, {
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
      }),
    );
  }
  const tcb = normalizeTcb(value);
  const compose = parseCompose(value);
  if (tcb?.event_log || tcb?.mrtd || tcb?.os_image_hash) {
    return withAttachedCodes(
      value,
      baseBundle(label, {
        shade: "unknown",
        shadeDetail: "This file looks like a tcb_info or attestation object. It was not read from chain in this run.",
        registration: { tcbInfo: tcb, appComposeSha256: tcb.app_compose ? sha256Hex(tcb.app_compose) : undefined },
        compose: tcb.app_compose ? parseCompose(tcb.app_compose) : compose,
        historySource: "file",
      }),
    );
  }
  if (compose) {
    return withAttachedCodes(
      value,
      baseBundle(label, {
        shade: "unknown",
        shadeDetail: "This file looks like an app compose or a deployment description. It was not read from chain in this run.",
        registration: null,
        compose,
        historySource: "file",
      }),
    );
  }
  return withAttachedCodes(
    value,
    baseBundle(label, {
      shade: "unknown",
      shadeDetail: "The JSON did not look like a registration, an app compose, or a deployment.",
      registration: null,
      compose: null,
      historySource: "file",
    }),
  );
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
  /** View names the capture actually recorded. Absent means none were recorded. */
  methodsPresent?: string[];
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
  const shade = capture.shade ?? "unknown";
  const named = capture.shade
    ? `The file named the interface ${capture.shade}.`
    : "The file did not name an interface, so none was assumed.";
  const redaction =
    capture.appComposeRedacted === true
      ? " Secret-looking env values in the stored app compose were removed before the file was written."
      : "";
  const hasRegistration = Boolean(
    capture.quoteHex ||
      capture.collateral !== undefined ||
      capture.checksum ||
      tcb ||
      capture.agentId ||
      capture.txHash ||
      capture.blockTimestampNs ||
      capture.originalAppComposeSha256,
  );
  const methodsPresent = Array.isArray(capture.methodsPresent)
    ? capture.methodsPresent.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  return baseBundle(capture.contractId || label, {
    network: capture.network ?? "offline",
    shade,
    shadeDetail: `Loaded from a Glassbox capture file. Chain state was not re-read. ${named}${redaction}`,
    codeHash: capture.codeHash,
    globalContractHash: capture.globalContractHash,
    registration: hasRegistration
      ? {
          quoteHex: capture.quoteHex,
          collateral: capture.collateral,
          checksum: capture.checksum,
          tcbInfo: tcb,
          appComposeSha256: capture.originalAppComposeSha256,
          appComposeRedacted: capture.appComposeRedacted === true,
          agentId: capture.agentId,
          txHash: capture.txHash,
          timestampSec: nsToSeconds(capture.blockTimestampNs),
        }
      : null,
    compose,
    agentView: capture.agentView,
    approvedCodehashes: capture.approvedCodehashes,
    accessKeys: capture.accessKeys,
    mpc: capture.mpcAllowlists,
    mpcFromSnapshot: Boolean(capture.mpcAllowlists?.length),
    historySource: "file",
    methodsPresent,
  });
}

function bundleFromLooseText(label: string, text: string): EvidenceBundle {
  const compose = parseCompose(text);
  return baseBundle(label, {
    shade: "unknown",
    shadeDetail: compose
      ? "This file is not JSON. Glassbox scanned it as a deployment or compose text. It was not read from chain."
      : "This file is not JSON and does not look like a compose. It was not read from chain.",
    registration: null,
    compose,
    historySource: "file",
  });
}

function withAttachedCodes(value: unknown, bundle: EvidenceBundle): EvidenceBundle {
  if (!value || typeof value !== "object") return bundle;
  const record = value as Record<string, unknown>;
  const app = firstAttached(record.codehash, record.agent_codehash);
  const contract = firstAttached(record.code_hash, record.contract_code_hash, record.codeHash);
  if (app && !bundle.agentView?.codehash) {
    bundle.agentView = { ...bundle.agentView, codehash: app };
  }
  if (contract && !bundle.codeHash) bundle.codeHash = contract;
  return bundle;
}

function firstAttached(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
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
    inputOrigin: "file",
    ...patch,
  };
}
