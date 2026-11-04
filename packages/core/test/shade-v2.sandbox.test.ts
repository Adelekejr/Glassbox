import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, KeyPair, keyStores } from "near-api-js";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { auditAccount } from "../src/audit.js";

/**
 * Local NEAR sandbox only. The wasm is shade-contract-template from
 * NearDeFi/shade-agent-framework @ 35758f3 (Apache-2.0), built with
 * cargo +1.86.0, RUSTFLAGS="-C target-cpu=mvp -C link-arg=-s",
 * --release --target wasm32-unknown-unknown --locked.
 * No testnet transaction and no NEAR is spent.
 */
const wasmPath = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shade-contract-template.wasm");
const ZEROS_48 = "0".repeat(96);
const ZEROS_32 = "0".repeat(64);
const ZEROS_16 = "0".repeat(32);
const GAS = 300_000_000_000_000n;

const measurements = {
  rtmrs: { mrtd: ZEROS_48, rtmr0: ZEROS_48, rtmr1: ZEROS_48, rtmr2: ZEROS_48 },
  key_provider_event_digest: ZEROS_48,
  app_compose_hash_payload: ZEROS_32,
};

const attestation = {
  quote: [] as number[],
  collateral: {
    tcb_info_issuer_chain: "",
    tcb_info: "",
    tcb_info_signature: "",
    qe_identity_issuer_chain: "",
    qe_identity: "",
    qe_identity_signature: "",
    pck_crl_issuer_chain: "",
    root_ca_crl: "",
    pck_crl: "",
  },
  tcb_info: {
    mrtd: ZEROS_48,
    rtmr0: ZEROS_48,
    rtmr1: ZEROS_48,
    rtmr2: ZEROS_48,
    rtmr3: ZEROS_48,
    os_image_hash: "",
    compose_hash: ZEROS_32,
    device_id: ZEROS_32,
    app_compose: "",
    event_log: [] as unknown[],
  },
};

test("shade v2 sandbox: detection and approved-measurement compare", { timeout: 180_000 }, async () => {
  const sandbox = await Sandbox.start({});
  try {
    const keyStore = new keyStores.InMemoryKeyStore();
    const rootKey = KeyPair.fromString(DEFAULT_PRIVATE_KEY as `ed25519:${string}`);
    await keyStore.setKey("sandbox", DEFAULT_ACCOUNT_ID, rootKey);
    const shadeKey = KeyPair.fromRandom("ed25519");
    const agentKey = KeyPair.fromRandom("ed25519");
    const shadeId = `shade.${DEFAULT_ACCOUNT_ID}`;
    const agentId = `agent.${DEFAULT_ACCOUNT_ID}`;
    await keyStore.setKey("sandbox", shadeId, shadeKey);
    await keyStore.setKey("sandbox", agentId, agentKey);

    const near = await connect({
      networkId: "sandbox",
      nodeUrl: sandbox.rpcUrl,
      keyStore,
    });
    const root = await near.account(DEFAULT_ACCOUNT_ID);
    const balance = 20n * 10n ** 24n;
    await root.createAccount(shadeId, shadeKey.getPublicKey(), balance);
    await root.createAccount(agentId, agentKey.getPublicKey(), balance);
    const shade = await near.account(shadeId);
    const agent = await near.account(agentId);
    await shade.deployContract(readFileSync(wasmPath));
    await shade.functionCall({
      contractId: shadeId,
      methodName: "new",
      args: {
        requires_tee: false,
        attestation_expiration_time_ms: "315360000000",
        owner_id: shadeId,
        mpc_contract_id: "mpc.sandbox",
      },
      gas: GAS,
      attachedDeposit: 0n,
    });
    await shade.functionCall({
      contractId: shadeId,
      methodName: "approve_measurements",
      args: { measurements },
      gas: GAS,
      attachedDeposit: 0n,
    });
    await shade.functionCall({
      contractId: shadeId,
      methodName: "approve_ppids",
      args: { ppids: [ZEROS_16] },
      gas: GAS,
      attachedDeposit: 0n,
    });
    await shade.functionCall({
      contractId: shadeId,
      methodName: "whitelist_agent_for_local",
      args: { account_id: agentId },
      gas: GAS,
      attachedDeposit: 0n,
    });
    await agent.functionCall({
      contractId: shadeId,
      methodName: "register_agent",
      args: { attestation },
      gas: GAS,
      attachedDeposit: 5_000_000_000_000_000_000_000n,
    });

    const report = await auditAccount(shadeId, {
      network: "testnet",
      rpcEndpoints: [sandbox.rpcUrl],
      // A one-node sandbox has not finalized the registration block yet.
      finality: "optimistic",
      skipHistory: true,
      skipMpc: true,
      skipFreshCollateral: true,
      rpcIntervalMs: 20,
    });
    assert.equal(report.shade, "shade-v2");
    const byId = Object.fromEntries(report.findings.map((finding) => [finding.id, finding]));
    assert.equal(byId["shade.interface"].ladder, "PROVEN");
    assert.match(byId["shade.interface"].plainEnglish, /requires_tee is false/);
    assert.equal(byId["measurements.approved"].ladder, "PROVEN");
    assert.ok(byId["measurements.approved"].evidence.some((item) => item.label === agentId));
    assert.equal(byId["measurements.local_default"].ladder, "RISKY");
    assert.equal(byId["agent.validity"].ladder, "PROVEN");
    assert.doesNotMatch(JSON.stringify(report), /hacked/i);
    assert.doesNotMatch(JSON.stringify(report), /currently running/i);
  } finally {
    await sandbox.tearDown();
  }
});
