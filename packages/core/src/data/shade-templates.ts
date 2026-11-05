import { createHash } from "node:crypto";
import { base58Encode } from "./base58.js";

/**
 * Contract wasm Glassbox can identify by code_hash.
 * The bytes live in the test fixture (Apache-2.0, shade-agent-framework
 * commit 35758f3). This list is that one template. A miss is not a judgement.
 */
export interface ShadeTemplate {
  name: string;
  commit: string;
  sha256: string;
  /** NEAR account code_hash: base58 of sha256(wasm). */
  codeHash: string;
  source: string;
}

export const SHADE_CONTRACT_TEMPLATES: readonly ShadeTemplate[] = [
  {
    name: "shade-contract-template",
    commit: "35758f3",
    sha256: "5c99b80de3d91b3e4f6ebee144925d2f409efb68bdba5897339cb3f35da672cd",
    codeHash: "7EUTZnq9jErHV1Ze9FLtDmY7sDbwGNcxxRnuV4dx8Cse",
    source: "https://github.com/NearDeFi/shade-agent-framework",
  },
];

/** view_account code_hash when the account has no contract code. */
export const EMPTY_CONTRACT_CODE_HASH = "11111111111111111111111111111111";

export function codeHashOfWasm(bytes: Uint8Array): { sha256: string; codeHash: string } {
  const digest = createHash("sha256").update(bytes).digest();
  return { sha256: digest.toString("hex"), codeHash: base58Encode(digest) };
}

export function matchShadeTemplate(codeHash: string | undefined | null): ShadeTemplate | null {
  if (!codeHash) return null;
  const trimmed = codeHash.trim();
  const hex = trimmed.toLowerCase().replace(/^0x/, "");
  return (
    SHADE_CONTRACT_TEMPLATES.find((row) => row.codeHash === trimmed || row.sha256 === hex) ?? null
  );
}
