import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildReport } from "../src/report.js";
import { parseCompose, sha256Hex } from "../src/evidence/compose.js";
import { planReportAnchor } from "../src/signed/anchor.js";
import { canonicalJson, canonicalSha256 } from "../src/signed/canonical.js";
import { loadOrCreateSigningKey } from "../src/signed/keys.js";
import { signReport } from "../src/signed/report.js";
import { networkForVerify, verifySignedReport } from "../src/signed/verify.js";
import type { EvidenceBundle } from "../src/types.js";

const generatedAt = "2026-11-04T12:00:00.000Z";
const contract = "example-agent.testnet";
const agent = "a".repeat(64);
const txHash = "HczqYXdRBZfyTtnQiPqGRXe3zEhvwHu3hyCUkqMq8VjN";
const compose = JSON.stringify({
  public_logs: true,
  docker_compose_file:
    "services:\n  app:\n    image: nginx:latest\n    volumes:\n      - /var/run/tappd.sock:/var/run/tappd.sock\n",
});

function bundle(): EvidenceBundle {
  return {
    target: contract,
    network: "testnet",
    shade: "unknown",
    shadeDetail: "Signed-report fixture. Chain state was not read.",
    methodsPresent: [],
    registration: {
      tcbInfo: { app_compose: compose },
      appComposeSha256: sha256Hex(compose),
      agentId: agent,
      txHash,
      blockHeight: 42,
      timestampSec: 1_700_000_000,
    },
    compose: parseCompose(compose),
    historySource: "file",
    rpcEndpoints: [],
    generatedAt,
  };
}

function txResult(height: number) {
  return {
    transaction: {
      signer_id: agent,
      receiver_id: contract,
      actions: [
        {
          FunctionCall: {
            method_name: "register_agent",
            args: Buffer.from(JSON.stringify({ tcb_info: { app_compose: compose } }), "utf8").toString("base64"),
          },
        },
      ],
    },
    transaction_outcome: { block_hash: "block-hash" },
    height,
  };
}

test("canonical JSON ignores key order", () => {
  const left = canonicalSha256({ b: 1, a: { d: 2, c: 3 } });
  const right = canonicalSha256({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(left, right);
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("network selection follows the account suffix", () => {
  assert.equal(networkForVerify("ac-sandbox.votron.testnet", "testnet"), "testnet");
  assert.equal(networkForVerify("ironshield.near", "mainnet"), "mainnet");
  assert.equal(networkForVerify("v1.signer", "mainnet"), "mainnet");
  assert.equal(networkForVerify("v1.signer", "offline"), null);
  assert.throws(() => networkForVerify("ironshield.near", "testnet"), /suffix/);
});

test("a signed report verifies against a mocked archival transaction", async () => {
  const keyDir = mkdtempSync(join(tmpdir(), "glassbox-key-"));
  const previous = process.env.GLASSBOX_SIGNING_KEY;
  process.env.GLASSBOX_SIGNING_KEY = join(keyDir, "report-signing-key.pem");
  try {
    const report = buildReport(bundle(), { now: new Date(generatedAt) });
    const { envelope, key } = signReport(report);
    assert.equal(key.created, true);
    assert.equal(envelope.sha256, canonicalSha256(envelope.body));
    assert.equal(envelope.signature.alg, "ed25519");
    assert.equal(envelope.body.inputs.tools["@phala/dcap-qvl"], report.verifier.version);
    assert.equal(envelope.body.inputs.blockHeight, 42);
    assert.equal(envelope.anchor.status, "skipped");
    assert.match(envelope.anchor.reason, /does not send a transaction/);
    assert.doesNotMatch(JSON.stringify(envelope), /hacked/i);
    assert.doesNotMatch(JSON.stringify(envelope), /currently running/i);

    const urls: string[] = [];
    const ok = await verifySignedReport(envelope, {
      fetch: async (input, init) => {
        urls.push(String(input));
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "tx") {
          return Response.json({ jsonrpc: "2.0", result: txResult(42) });
        }
        return Response.json({ jsonrpc: "2.0", result: { header: { height: 42, timestamp: "1700000000000000000" } } });
      },
    });
    assert.equal(ok.ok, true, ok.notes.join(" "));
    assert.equal(ok.refetched, true);
    assert.equal(ok.blockHeightOk, true);
    assert.ok(ok.compared > 0);
    assert.ok(urls.some((url) => url.includes("archival-rpc.testnet")));

    const drifted = await verifySignedReport(envelope, {
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "tx") return Response.json({ jsonrpc: "2.0", result: txResult(7) });
        return Response.json({ jsonrpc: "2.0", result: { header: { height: 7 } } });
      },
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.blockHeightOk, false);

    const tampered = structuredClone(envelope);
    tampered.body.verdict.overall = "PROVEN";
    const badHash = await verifySignedReport(tampered, { offline: true });
    assert.equal(badHash.hashOk, false);
    assert.equal(badHash.ok, false);

    const badSig = structuredClone(envelope);
    badSig.signature.sig = "00".repeat(64);
    const badSignature = await verifySignedReport(badSig, { offline: true });
    assert.equal(badSignature.signatureOk, false);
  } finally {
    if (previous === undefined) delete process.env.GLASSBOX_SIGNING_KEY;
    else process.env.GLASSBOX_SIGNING_KEY = previous;
  }
});

test("anchoring stays off even when the opt-in flag is set", () => {
  const previous = process.env.GLASSBOX_ANCHOR;
  process.env.GLASSBOX_ANCHOR = "1";
  try {
    const outcome = planReportAnchor({
      reportSha256: "ab".repeat(32),
      network: "mainnet",
      contract: "ironshield.near",
    });
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /does not send a transaction/);
  } finally {
    if (previous === undefined) delete process.env.GLASSBOX_ANCHOR;
    else process.env.GLASSBOX_ANCHOR = previous;
  }
});

test("an existing signing key is reused", () => {
  const keyDir = mkdtempSync(join(tmpdir(), "glassbox-key-"));
  const path = join(keyDir, "report-signing-key.pem");
  const first = loadOrCreateSigningKey(path);
  const second = loadOrCreateSigningKey(path);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.publicKeyHex, second.publicKeyHex);
});
