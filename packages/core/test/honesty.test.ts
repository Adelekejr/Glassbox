import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditAccount, auditValue } from "../src/audit.js";
import { buildReport } from "../src/report.js";
import { isLiveChainProof } from "../src/provenance.js";
import type { ApprovedMeasurementRow, Report } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const votronPath = join(here, "fixtures/votron-registration.json");
const FROZEN = new Date("2026-11-04T12:00:00.000Z");
const FIXED_HASH = "ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6";

test("a missing requires_tee is not Shade local mode, and get_contract_info alone is not shade-v2", async () => {
  const missingFlag = await auditAccount("only-info.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => viewOk({ owner_id: "only-info.testnet" }),
    }),
  });
  assert.notEqual(missingFlag.shade, "shade-v2");
  assert.equal(missingFlag.shade, "unknown");
  const missing = finding(missingFlag, "shade.interface");
  assert.equal(missing.ladder, "NOT_PROVEN");
  assert.equal(isLiveChainProof(missing), false);
  assert.doesNotMatch(missing.plainEnglish, /local mode/i);
  assert.doesNotMatch(missing.plainEnglish, /requires_tee is false/);

  const explicitFalse = await auditAccount("local-flag.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => viewOk({ requires_tee: false }),
    }),
  });
  assert.notEqual(explicitFalse.shade, "shade-v2");
  assert.equal(finding(explicitFalse, "shade.interface").ladder, "NOT_PROVEN");
  assert.doesNotMatch(finding(explicitFalse, "shade.interface").plainEnglish, /local mode/i);

  const v2WithoutFlag = await auditAccount("v2-no-flag.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => viewOk({ owner_id: "v2-no-flag.testnet" }),
      get_agents: () => viewOk([]),
      get_approved_measurements: () => viewOk([]),
    }),
  });
  assert.equal(v2WithoutFlag.shade, "shade-v2");
  const named = finding(v2WithoutFlag, "shade.interface");
  assert.equal(named.ladder, "PROVEN");
  assert.match(named.plainEnglish, /did not include requires_tee/);
  assert.match(named.plainEnglish, /was not proven/);
  assert.doesNotMatch(named.plainEnglish, /registration path is Shade local mode/);
});

test("a missing measurement field is an incomplete comparison, not a proven match", () => {
  const row = measurementRow();
  const approvedMissingDigest = { ...row };
  delete approvedMissingDigest.key_provider_event_digest;
  const incomplete = reportWithMeasurements([approvedMissingDigest], [row]);
  const missing = finding(incomplete, "measurements.approved");
  assert.equal(missing.ladder, "NOT_PROVEN");
  assert.match(missing.title, /incomplete/i);
  assert.match(missing.plainEnglish, /missing/);
  assert.match(missing.plainEnglish, /not a match/);
  assert.doesNotMatch(missing.plainEnglish, /key-provider digest, and app-compose hash match/);

  const approvedMissingCompose = { ...row };
  delete approvedMissingCompose.app_compose_hash_payload;
  const composeGap = finding(reportWithMeasurements([approvedMissingCompose], [row]), "measurements.approved");
  assert.equal(composeGap.ladder, "NOT_PROVEN");

  const mismatched = { ...row, mrtd: "1".repeat(96) };
  const miss = finding(reportWithMeasurements([row], [mismatched]), "measurements.approved");
  assert.equal(miss.ladder, "RISKY");
  assert.match(miss.title, /not on the approved list/);

  const matched = finding(reportWithMeasurements([row], [row]), "measurements.approved");
  assert.equal(matched.ladder, "PROVEN");
  assert.match(matched.plainEnglish, /key-provider digest, and app-compose hash match/);
});

test("a blank allowed_envs entry stays overly broad", async () => {
  const blank = await auditValue({ allowed_envs: [""] }, { now: FROZEN });
  const findingBlank = finding(blank, "compose.allowed_envs");
  assert.equal(findingBlank.ladder, "RISKY");
  assert.match(findingBlank.plainEnglish, /overly broad|empty/i);
  assert.notEqual(findingBlank.ladder, "PROVEN");

  const spaces = await auditValue({ allowed_envs: ["   "] }, { now: FROZEN });
  assert.equal(finding(spaces, "compose.allowed_envs").ladder, "RISKY");

  const mixed = await auditValue({ allowed_envs: ["", "PATH"] }, { now: FROZEN });
  assert.equal(finding(mixed, "compose.allowed_envs").ladder, "RISKY");
});

test("a side-field os image hash is not a proven fixed image without the event log and a verified quote", async () => {
  const fixture = JSON.parse(readFileSync(votronPath, "utf8")) as {
    quoteHex: string;
    collateral: unknown;
    blockTimestampNs: string;
  };
  const sideOnly = await auditValue(
    {
      tcb_info: {
        os_image_hash: FIXED_HASH,
        event_log: [],
      },
    },
    { now: FROZEN },
  );
  assertNotFixed(sideOnly);

  const eventWithoutQuote = await auditValue(
    {
      tcb_info: {
        os_image_hash: FIXED_HASH,
        event_log: [osImageEvent(FIXED_HASH)],
      },
    },
    { now: FROZEN },
  );
  assertNotFixed(eventWithoutQuote);

  const quoteWithoutEvent = await auditValue(
    {
      kind: "glassbox-capture",
      contractId: "fixed.example.testnet",
      network: "testnet",
      quoteHex: fixture.quoteHex,
      collateral: fixture.collateral,
      blockTimestampNs: fixture.blockTimestampNs,
      tcbInfo: { os_image_hash: FIXED_HASH, event_log: [] },
    },
    { now: FROZEN, label: "quote-without-event" },
  );
  assert.equal(finding(quoteWithoutEvent, "tdx.signature").ladder, "PROVEN");
  assertNotFixed(quoteWithoutEvent);

  const attested = await auditValue(
    {
      kind: "glassbox-capture",
      contractId: "fixed.example.testnet",
      network: "testnet",
      quoteHex: fixture.quoteHex,
      collateral: fixture.collateral,
      blockTimestampNs: fixture.blockTimestampNs,
      tcbInfo: {
        os_image_hash: FIXED_HASH,
        event_log: [osImageEvent(FIXED_HASH)],
      },
    },
    { now: FROZEN, label: "quote-and-event" },
  );
  assert.equal(finding(attested, "tdx.signature").ladder, "PROVEN");
  const range = finding(attested, "dstack.range");
  const upgrade = finding(attested, "dstack.upgrade");
  const provenance = finding(attested, "measurements.provenance");
  assert.equal(range.ladder, "PROVEN");
  assert.match(range.title, /known fixed image/);
  assert.equal(upgrade.ladder, "PROVEN");
  assert.match(upgrade.title, /does not apply to this fixed image/);
  assert.equal(provenance.ladder, "PROVEN");
  assert.match(provenance.title, /known fixed image/);
});

test("a missing or unrecognized agent validity is not proven, and a real invalid agent stays risky", async () => {
  const missing = await auditAccount("validity.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => viewOk({ requires_tee: true, owner_id: "validity.testnet" }),
      get_agents: () =>
        viewOk([
          {
            account_id: "agent.validity.testnet",
            measurements: {
              mrtd: "ab".repeat(48),
              rtmr0: "cd".repeat(48),
              rtmr1: "ef".repeat(48),
              rtmr2: "12".repeat(48),
            },
          },
        ]),
      get_approved_measurements: () => viewOk([]),
    }),
  });
  const validity = finding(missing, "agent.validity");
  assert.equal(validity.ladder, "NOT_PROVEN");
  assert.equal(isLiveChainProof(validity), false);
  assert.equal(validity.provenance.liveChain, false);
  assert.doesNotMatch(validity.provenance.label, /Fresh chain observation/);
  assert.match(validity.plainEnglish, /did not include a recognized validity field/);
  assert.match(validity.plainEnglish, /was not proven/);
  assert.doesNotMatch(validity.plainEnglish, /is validity was not/);
  assert.doesNotMatch(validity.title, /not valid/);

  const unrecognizedView = await auditAccount("validity-word.testnet", {
    network: "testnet",
    now: FROZEN,
    skipHistory: true,
    skipMpc: true,
    skipFreshCollateral: true,
    rpcEndpoints: ["https://rpc.example"],
    rpcIntervalMs: 0,
    fetch: rpcFetch({
      get_contract_info: () => viewOk({ requires_tee: true }),
      get_agents: () =>
        viewOk([
          {
            account_id: "agent.validity-word.testnet",
            validity: "Banana",
            measurements: {
              mrtd: "ab".repeat(48),
              rtmr0: "cd".repeat(48),
              rtmr1: "ef".repeat(48),
              rtmr2: "12".repeat(48),
            },
          },
        ]),
      get_approved_measurements: () => viewOk([]),
    }),
  });
  const word = finding(unrecognizedView, "agent.validity");
  assert.equal(word.ladder, "NOT_PROVEN");
  assert.doesNotMatch(word.plainEnglish, /Banana/);
  assert.doesNotMatch(word.plainEnglish, /is not valid/);
  assert.equal(isLiveChainProof(word), false);

  const unrecognized = reportWithAgents([{ accountId: "agent.test.near", validity: "", valid: null }]);
  const unknown = finding(unrecognized, "agent.validity");
  assert.equal(unknown.ladder, "NOT_PROVEN");
  assert.match(unknown.plainEnglish, /recognized validity field/);

  const invalid = reportWithAgents([
    { accountId: "agent.test.near", validity: "Invalid (expired)", valid: false },
  ]);
  const risky = finding(invalid, "agent.validity");
  assert.equal(risky.ladder, "RISKY");
  assert.match(risky.plainEnglish, /agent\.test\.near is Invalid \(expired\)/);
});

test("random JSON is not a registered compose, and a partial capture reports only its own fields", async () => {
  for (const value of [{ hello: 1 }, []]) {
    const report = await auditValue(value, { now: FROZEN });
    assert.match(finding(report, "shade.interface").plainEnglish, /did not look like/);
    for (const id of ["dstack.secret_env", "compose.plaintext_secrets", "compose.sockets"]) {
      assert.equal(
        report.findings.find((item) => item.id === id),
        undefined,
        `${JSON.stringify(value)} must not prove ${id}`,
      );
    }
    assert.equal(
      report.findings.some((item) => item.ladder === "PROVEN" && /secret|socket/i.test(`${item.id} ${item.title}`)),
      false,
    );
  }

  const capture = await auditValue(
    {
      kind: "glassbox-capture",
      contractId: "example.near",
      network: "mainnet",
    },
    { now: FROZEN },
  );
  assert.equal(capture.shade, "unknown");
  const iface = finding(capture, "shade.interface");
  assert.equal(iface.ladder, "NOT_PROVEN");
  assert.match(iface.plainEnglish, /did not name an interface/);
  assert.doesNotMatch(iface.plainEnglish, /shade-v1/);
  assert.doesNotMatch(JSON.stringify(iface.evidence), /get_agent/);
  assert.doesNotMatch(JSON.stringify(capture), /nearblocks\.io/i);
  assert.doesNotMatch(JSON.stringify(capture.methodProbes ?? []), /get_agent/);
});

function assertNotFixed(report: Report): void {
  const range = finding(report, "dstack.range");
  const upgrade = finding(report, "dstack.upgrade");
  const provenance = finding(report, "measurements.provenance");
  assert.equal(range.ladder, "NOT_PROVEN");
  assert.equal(upgrade.ladder, "NOT_PROVEN");
  assert.equal(provenance.ladder, "NOT_PROVEN");
  assert.doesNotMatch(range.title, /is a known fixed image/);
  assert.doesNotMatch(upgrade.title, /does not apply to this fixed image/);
  assert.doesNotMatch(provenance.title, /is a known fixed image/);
  assert.match(`${range.plainEnglish} ${provenance.plainEnglish}`, /incomplete|not a proven fixed image|not treated as a known fixed image/);
}

function osImageEvent(hash: string) {
  return { imr: 3, event: "os-image-hash", digest: "bb".repeat(48), event_payload: hash };
}

function measurementRow(): ApprovedMeasurementRow {
  return {
    mrtd: "a".repeat(96),
    rtmr0: "b".repeat(96),
    rtmr1: "c".repeat(96),
    rtmr2: "d".repeat(96),
    key_provider_event_digest: "e".repeat(96),
    app_compose_hash_payload: "f".repeat(64),
  };
}

function reportWithMeasurements(approved: ApprovedMeasurementRow[], registered: ApprovedMeasurementRow[]): Report {
  return buildReport(
    {
      target: "shade.test.near",
      network: "testnet",
      shade: "shade-v2",
      shadeDetail: "v2",
      methodsPresent: ["get_contract_info", "get_agents", "get_approved_measurements"],
      registration: null,
      compose: null,
      v2Agents: registered.map((measurements, index) => ({
        accountId: `agent-${index}.test.near`,
        measurements,
        validity: "Valid",
        valid: true,
      })),
      approvedMeasurements: approved,
      rpcEndpoints: [],
      generatedAt: FROZEN.toISOString(),
      inputOrigin: "chain",
      historySource: "none",
    },
    { now: FROZEN },
  );
}

function reportWithAgents(agents: { accountId: string; validity: string; valid: boolean | null }[]): Report {
  const measurements = measurementRow();
  return buildReport(
    {
      target: "shade.test.near",
      network: "testnet",
      shade: "shade-v2",
      shadeDetail: "v2",
      methodsPresent: ["get_agents"],
      registration: null,
      compose: null,
      v2Agents: agents.map((agent) => ({ ...agent, measurements })),
      rpcEndpoints: [],
      generatedAt: FROZEN.toISOString(),
      inputOrigin: "chain",
      historySource: "none",
    },
    { now: FROZEN },
  );
}

function finding(report: Report, id: string) {
  const item = report.findings.find((entry) => entry.id === id);
  assert.ok(item, id);
  return item;
}

function rpcFetch(handlers: Record<string, () => Response>): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { params?: { request_type?: string; method_name?: string } };
    const params = body.params ?? {};
    if (params.request_type === "view_account") {
      return json({ result: { code_hash: "abc", storage_usage: 1 } });
    }
    if (params.request_type === "view_access_key_list") {
      return json({ result: { keys: [] } });
    }
    if (params.request_type === "call_function") {
      const handler = handlers[params.method_name ?? ""];
      if (!handler) return methodNotFound();
      return handler();
    }
    throw new Error(`unexpected rpc ${params.request_type ?? "none"}`);
  };
}

function viewOk(value: unknown): Response {
  return json({ result: { result: Array.from(Buffer.from(JSON.stringify(value), "utf8")) } });
}

function methodNotFound(): Response {
  return json({
    result: {
      result: [],
      error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
    },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
