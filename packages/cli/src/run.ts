import { existsSync, readFileSync } from "node:fs";
import { auditAccount, auditFile, auditValue, formatReport, type Network, type Report } from "core";

export interface ParsedArgs {
  json: boolean;
  help: boolean;
  network?: Network;
  target?: string;
}

export function usage(): string {
  return [
    "glassbox <account-or-file> [--json] [--network testnet|mainnet]",
    "",
    "Read-only auditor for AI-agent contracts on NEAR.",
    "An account ending in .testnet or .near selects the network.",
    "Any other account is tried on mainnet, then testnet.",
    "A path to JSON (registration, app compose, or deployment) is audited offline.",
    "Use - to read JSON from stdin.",
  ].join("\n");
}

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let json = false;
  let help = false;
  let network: Network | undefined;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--pccs" || arg === "--pccs-url") {
      return { error: "A caller-supplied PCCS URL is not accepted. Collateral is fetched from the built-in allowlist." };
    }
    if (arg === "--network") {
      const value = argv[index + 1];
      if (value !== "testnet" && value !== "mainnet") {
        return { error: "--network must be testnet or mainnet." };
      }
      network = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return { error: `Unknown argument ${arg}.` };
    positional.push(arg);
  }
  if (positional.length > 1) return { error: "Pass one account id or one file." };
  return { json, help, network, target: positional[0] };
}

export async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    return { code: 2, stdout: "", stderr: `${parsed.error}\n\n${usage()}\n` };
  }
  if (parsed.help || !parsed.target) {
    return { code: parsed.help ? 0 : 2, stdout: `${usage()}\n`, stderr: "" };
  }
  try {
    const file = parsed.target !== "-" && existsSync(parsed.target);
    const stderr = file || parsed.target === "-"
      ? ""
      : `Reading ${parsed.target} from public NEAR RPC. History uses NearBlocks and is spaced to stay within the free limit.\n`;
    const report = file
      ? await auditFile(parsed.target as string, { network: parsed.network })
      : parsed.target === "-"
        ? await auditStdin(parsed.network)
        : await auditAccount(parsed.target, { network: parsed.network });
    return { code: 0, stdout: render(report, parsed.json), stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function auditStdin(network?: Network): Promise<Report> {
  const text = readFileSync(0, "utf8");
  return auditValue(JSON.parse(text) as unknown, { network, label: "stdin" });
}

function render(report: Report, json: boolean): string {
  return json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report);
}
