import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface SigningKey {
  privateKey: KeyObject;
  publicKeyHex: string;
  path: string;
  created: boolean;
}

/** Default location. Override with GLASSBOX_SIGNING_KEY. Never commit this file. */
export function defaultSigningKeyPath(): string {
  if (process.env.GLASSBOX_SIGNING_KEY) return process.env.GLASSBOX_SIGNING_KEY;
  return join(homedir(), ".config", "glassbox", "report-signing-key.pem");
}

export function publicKeyPathFor(privatePath: string): string {
  return privatePath.endsWith(".pem") ? `${privatePath.slice(0, -4)}.pub` : `${privatePath}.pub`;
}

/**
 * Load the CLI signing key, or create one on first use.
 * The private key stays on this computer. Glassbox does not upload it.
 */
export function loadOrCreateSigningKey(path = defaultSigningKeyPath()): SigningKey {
  if (existsSync(path)) {
    const pem = readFileSync(path, "utf8");
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new Error(`The signing key at ${path} is not an ed25519 key.`);
    }
    const publicKeyHex = rawPublicKey(createPublicKey(privateKey));
    return { privateKey, publicKeyHex, path, created: false };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, pem, { mode: 0o600, flag: "wx" });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Some filesystems ignore mode. The file is still outside the repo.
  }
  const publicKeyHex = rawPublicKey(publicKey);
  const pubPath = publicKeyPathFor(path);
  writeFileSync(pubPath, `${publicKeyHex}\n`, { mode: 0o644 });
  return { privateKey, publicKeyHex, path, created: true };
}

export function signUtf8(privateKey: KeyObject, message: string): string {
  return sign(null, Buffer.from(message, "utf8"), privateKey).toString("hex");
}

export function verifyEd25519(publicKeyHex: string, message: string, signatureHex: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) return false;
  if (!/^[0-9a-fA-F]+$/.test(signatureHex) || signatureHex.length === 0 || signatureHex.length % 2 !== 0) return false;
  try {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]);
    const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

function rawPublicKey(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der).subarray(-32).toString("hex");
}
