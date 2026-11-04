/**
 * Build the redacted votron fixture from a raw register_agent args JSON file.
 * The raw file stays out of git. Secret-looking values are removed before write.
 *
 * Usage: tsx scripts/build-fixture.ts /path/to/raw-args.json
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactAppCompose, sha256Hex } from "../src/evidence/compose.js";

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Pass the raw register_agent args JSON path.\n");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(inputPath, "utf8")) as {
  quote_hex: string;
  collateral: string | object;
  checksum: string;
  tcb_info: string;
};
const tcb = JSON.parse(raw.tcb_info) as { app_compose: string; event_log: { event: string; event_payload: string }[] };
const originalHash = sha256Hex(tcb.app_compose);
const payload = tcb.event_log.find((event) => event.event === "compose-hash")?.event_payload;
if (payload !== originalHash) {
  throw new Error("Refusing to write: compose-hash event does not match sha256(app_compose).");
}
const { redacted, removed } = redactAppCompose(tcb.app_compose);
// The votron compose stores env values as ${NAME} references. The salt is a
// real literal and must be removed. A future capture that inlines a key must
// remove that too; redactAppCompose throws if a removed value survives.
if (!redacted.includes("REDACTED")) {
  throw new Error("Redaction did not replace the compose salt or any literal secret.");
}
if (sha256Hex(redacted) === originalHash) {
  throw new Error("Redacted compose still hashes to the original. Values were not removed.");
}
tcb.app_compose = redacted;

const collateral = typeof raw.collateral === "string" ? JSON.parse(raw.collateral) : raw.collateral;
const out = {
  kind: "glassbox-capture",
  capturedAt: "2026-11-04T20:00:00.000Z",
  redaction:
    "app_compose env values that look like secrets, plus the compose salt, were replaced with REDACTED. originalAppComposeSha256 is sha256 of the on-chain string and matches the compose-hash event. The stored app_compose is not that preimage.",
  network: "testnet",
  contractId: "ac-sandbox.votron.testnet",
  agentId: "5ed6f9115c34750601502ca651d57df67836924ca0f3cf9fad27e23a7368c8a6",
  txHash: "HczqYXdRBZfyTtnQiPqGRXe3zEhvwHu3hyCUkqMq8VjN",
  blockTimestampNs: "1758945254420912613",
  codeHash: "2HkUtRxzdaucz8YqQUB24g5Crnn4NiuY2b7fp7SAVFeT",
  globalContractHash: null,
  shade: "shade-v1",
  appComposeRedacted: true,
  checksum: raw.checksum,
  originalAppComposeSha256: originalHash,
  agentView: {
    checksum: "83dc8af7f737301b395b2b342a6c8ae39c08dc2cc50f3c3993287a271f759911",
    codehash: "2a2f4704345359172f31e992188c60c2cbff4c2151dceeabccf472bad8031243",
  },
  approvedCodehashes: [
    {
      codehash: "2a2f4704345359172f31e992188c60c2cbff4c2151dceeabccf472bad8031243",
      txHash: "6pVb8TT7JDKNTeevK3EmnBg2kymBXivLSkNuD2rZLDa8",
      signer: "votron.testnet",
    },
  ],
  accessKeys: [
    {
      public_key: "ed25519:F7jZEsyZ2kr8qCddBY2F44DryGMFDy5i4xkkMMDu9Fep",
      access_key: { nonce: 211929744000004, permission: "FullAccess" },
    },
  ],
  mpcAllowlists: [
    {
      accountId: "v1.signer",
      network: "mainnet",
      entries: [
        { image_hash: "536d528f19cff6a45f384fb225e8a331e5554b9da45196d0fae148d191e8b36d", expiry_timestamp_seconds: null },
        { image_hash: "4572d8de226e20870d6961a1e0f364cd77817d4cf53fdba8001f56c75695089d", expiry_timestamp_seconds: 1793970889 },
      ],
    },
    {
      accountId: "v1.signer-prod.testnet",
      network: "testnet",
      entries: [
        { image_hash: "536d528f19cff6a45f384fb225e8a331e5554b9da45196d0fae148d191e8b36d", expiry_timestamp_seconds: null },
        { image_hash: "4572d8de226e20870d6961a1e0f364cd77817d4cf53fdba8001f56c75695089d", expiry_timestamp_seconds: 1793883543 },
      ],
    },
  ],
  quoteHex: raw.quote_hex,
  collateral,
  tcbInfo: tcb,
};

const serialized = JSON.stringify(out);
const stillThere = removed.filter((value) => value.length >= 8 && serialized.includes(value));
if (stillThere.length > 0) {
  throw new Error(`Refusing to write: ${stillThere.length} secret-looking value(s) still appear in the fixture.`);
}
const destination = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/votron-registration.json");
writeFileSync(destination, `${serialized}\n`);
process.stdout.write(`wrote ${destination} removed=${removed.length} hash=${originalHash}\n`);
