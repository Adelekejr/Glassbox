import { normalizeDigest } from "../evidence/digest.js";

/**
 * Guest OS image hashes Phala published for the releases that fix the
 * dstack guest-agent issue. Checked 2026-11-04.
 *
 * Sources:
 * - https://cloud.phala.com/dstack/0.5.12
 * - https://cloud.phala.com/dstack/0.6.1
 * - https://github.com/Dstack-TEE/dstack/releases (0.6.1 os_image_hash)
 *
 * Older images are intentionally absent. A hash that is not in this list is
 * "not a known fixed image". That is not a claim that the guest was broken into.
 */
export interface FixedImage {
  hash: string;
  name: string;
}

export const FIXED_OS_IMAGE_HASHES: readonly FixedImage[] = [
  {
    hash: "8db40cb23008d6213668b5816702d100b37b859a8a5bfd18d938ae3a1b3715bd",
    name: "dstack-0.5.12",
  },
  {
    hash: "e866e987221db357129ebc3f066b6706ef955889ea95e5510acbdf3d3055186b",
    name: "dstack-dev-0.5.12",
  },
  {
    hash: "91fd5d69ccee3e5ea4f2aeb8c9b632c4358c4ecfc29ba1aa6fb1e402af209829",
    name: "dstack-nvidia-0.5.12",
  },
  {
    hash: "e0c9312d9a2a7cdc54fdd86264474f502a97282b464b6cdba4544b1e8a211734",
    name: "dstack-nvidia-dev-0.5.12",
  },
  {
    hash: "ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6",
    name: "dstack-0.6.1",
  },
];

export function lookupFixedImage(hash: string | undefined | null): FixedImage | null {
  const norm = normalizeDigest(hash);
  if (!norm) return null;
  return FIXED_OS_IMAGE_HASHES.find((row) => row.hash === norm) ?? null;
}
