/** Same suffix rule as packages/core detectNetwork. Kept here so the browser does not import the audit library. */
export type NetworkName = "testnet" | "mainnet";

export function detectNetwork(accountId: string): NetworkName | null {
  const id = accountId.trim().toLowerCase();
  if (id.endsWith(".testnet")) return "testnet";
  if (id.endsWith(".near")) return "mainnet";
  return null;
}

export function describeInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Paste an account or JSON.";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "Pasted JSON. Chain network is not used.";
  const network = detectNetwork(trimmed);
  if (network) return `Account on ${network}.`;
  return "Account suffix is not .testnet or .near. Glassbox will try mainnet, then testnet.";
}
