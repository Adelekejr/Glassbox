import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  auditAccount,
  auditFile,
  auditValue,
  ANCHOR_INSTRUCTIONS,
  FIXTURE_INDEX_PATHS,
  defaultIndexPaths,
  buildAgentIndexFromFiles,
  crawlAgentIndex,
  diffReports,
  formatDiff,
  formatReport,
  renderIndexHtml,
  signReport,
  verifySignedReport,
  type Network,
  type Report,
} from "core";

export interface ParsedArgs {
  json: boolean;
  help: boolean;
  sign: boolean;
  anchor: boolean;
  out?: string;
  network?: Network;
  target?: string;
}

export function usage(): string {
  return [
    "glassbox <account-or-file> [--json] [--sign] [--anchor] [--out report.json] [--network testnet|mainnet]",
    "glassbox verify <report.json> [--offline]",
    "glassbox check <file> --fail-on risky",
    "glassbox diff <left> <right> [--json]",
    "glassbox index [--live] [--out proof-strip.json] [--html proof-strip.html]",
    "",
    "Read-only auditor for AI-agent contracts on NEAR.",
    "An account ending in .testnet or .near selects the network.",
    "Any other account is tried on mainnet, then testnet.",
    "A path to JSON (registration, app compose, or deployment) is audited offline.",
    "Use - to read JSON from stdin.",
    "--json prints the report. It stays the report when --sign is set.",
    "--sign writes a signed report file. The key stays on this computer.",
    "--anchor records that you asked to publish the report hash later. It does not send a transaction.",
    "verify checks the hash and signature, then re-reads the registration from archival RPC.",
    "check fails when the named rung is present. The default fixture path needs no chain.",
    "diff compares two accounts or two JSON files: compose, measurements, codehash, and findings.",
    "index --live crawls the known accounts. Without --live it uses local fixtures.",
  ].join("\n");
}

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let json = false;
  let help = false;
  let sign = false;
  let anchor = false;
  let out: string | undefined;
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
    if (arg === "--sign") {
      sign = true;
      continue;
    }
    if (arg === "--anchor") {
      anchor = true;
      continue;
    }
    if (arg === "--pccs" || arg === "--pccs-url") {
      return { error: "A caller-supplied PCCS URL is not accepted. Collateral is fetched from the built-in allowlist." };
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { error: "--out needs a file path." };
      out = value;
      sign = true;
      index += 1;
      continue;
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
  return { json, help, sign, anchor, out, network, target: positional[0] };
}

export async function run(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const head = argv[0];
  if (head === "verify") return runVerify(argv.slice(1));
  if (head === "check") return runCheck(argv.slice(1));
  if (head === "diff") return runDiff(argv.slice(1));
  if (head === "index") return runIndex(argv.slice(1));
  return runAudit(argv);
}

async function runAudit(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    return { code: 2, stdout: "", stderr: `${parsed.error}\n\n${usage()}\n` };
  }
  if (parsed.help || !parsed.target) {
    return { code: parsed.help ? 0 : 2, stdout: `${usage()}\n`, stderr: "" };
  }
  try {
    const file = parsed.target !== "-" && existsSync(parsed.target);
    const stderrLines: string[] = [];
    if (!file && parsed.target !== "-") {
      stderrLines.push(
        `Reading ${parsed.target} from public NEAR RPC. History uses NearBlocks and is spaced to stay within the free limit.`,
      );
    }
    const auditOptions = { network: parsed.network, anchorIntent: parsed.anchor };
    const report = file
      ? await auditFile(parsed.target as string, auditOptions)
      : parsed.target === "-"
        ? await auditStdin(parsed.network, parsed.anchor)
        : await auditAccount(parsed.target, auditOptions);
    if (parsed.sign) {
      const { envelope, key } = signReport(report);
      const out = parsed.out ?? "report.json";
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(envelope, null, 2)}\n`);
      if (key.created) {
        stderrLines.push(`A new signing key was created at ${key.path}. Keep that file private. It is not part of the repo.`);
      }
      stderrLines.push(`Signed report written to ${out}.`);
    }
    if (parsed.anchor) {
      stderrLines.push(report.anchor.reason);
      stderrLines.push(ANCHOR_INSTRUCTIONS);
    }
    const stderr = stderrLines.length ? `${stderrLines.join("\n")}\n` : "";
    return { code: 0, stdout: render(report, parsed.json), stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function runVerify(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let offline = false;
  let help = false;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "--offline") {
      offline = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--pccs" || arg === "--pccs-url") {
      return { code: 2, stdout: "", stderr: "A caller-supplied PCCS URL is not accepted.\n" };
    }
    if (arg.startsWith("-")) return { code: 2, stdout: "", stderr: `Unknown argument ${arg}.\n\n${usage()}\n` };
    positional.push(arg);
  }
  if (help || positional.length === 0) {
    return { code: help ? 0 : 2, stdout: `${usage()}\n`, stderr: "" };
  }
  if (positional.length > 1) return { code: 2, stdout: "", stderr: "Pass one signed report file.\n" };
  try {
    const value = JSON.parse(readFileSync(positional[0], "utf8")) as unknown;
    const result = await verifySignedReport(value, { offline });
    const lines = [
      `Hash: ${result.hashOk ? "matches" : "does not match"}`,
      `Signature: ${result.signatureOk ? "matches" : "does not match"}`,
      ...result.notes,
    ];
    return { code: result.ok ? 0 : 1, stdout: `${lines.join("\n")}\n`, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function runCheck(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let failOn: Array<"risky" | "notProven" | "proven"> = [];
  let help = false;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--pccs" || arg === "--pccs-url") {
      return { code: 2, stdout: "", stderr: "A caller-supplied PCCS URL is not accepted.\n" };
    }
    if (arg === "--fail-on") {
      const value = argv[index + 1];
      if (!value) return { code: 2, stdout: "", stderr: "--fail-on needs risky, not-proven, or proven.\n" };
      const rung = parseRung(value);
      if (!rung) return { code: 2, stdout: "", stderr: "--fail-on needs risky, not-proven, or proven.\n" };
      failOn.push(rung);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return { code: 2, stdout: "", stderr: `Unknown argument ${arg}.\n\n${usage()}\n` };
    positional.push(arg);
  }
  if (help) return { code: 0, stdout: `${usage()}\n`, stderr: "" };
  if (positional.length !== 1) return { code: 2, stdout: "", stderr: "Pass one JSON file to check.\n" };
  if (failOn.length === 0) return { code: 2, stdout: "", stderr: "Pass --fail-on risky (or not-proven, or proven).\n" };
  try {
    const report = await auditFile(positional[0]);
    const hit = failOn.filter((rung) => report.summary[rung] > 0);
    const lines = [
      "glassbox check",
      `Target: ${report.target}`,
      `Summary: ${report.summary.risky} risky, ${report.summary.notProven} not proven, ${report.summary.proven} proven.`,
    ];
    if (hit.length > 0) {
      lines.push(`Failed because this registered configuration has ${hit.join(", ")}.`);
      return { code: 1, stdout: `${lines.join("\n")}\n`, stderr: "" };
    }
    lines.push("No named rung was present.");
    return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function runIndex(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let live = false;
  let help = false;
  const defaults = defaultIndexPaths();
  let out = defaults.json;
  let html = defaults.html;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--pccs" || arg === "--pccs-url") {
      return { code: 2, stdout: "", stderr: "A caller-supplied PCCS URL is not accepted.\n" };
    }
    if (arg === "--out" || arg === "--html") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { code: 2, stdout: "", stderr: `${arg} needs a file path.\n` };
      if (arg === "--out") out = value;
      else html = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return { code: 2, stdout: "", stderr: `Unknown argument ${arg}.\n\n${usage()}\n` };
    return { code: 2, stdout: "", stderr: "glassbox index does not take an account. Use --live or the local fixtures.\n" };
  }
  if (help) return { code: 0, stdout: `${usage()}\n`, stderr: "" };
  try {
    if (live) {
      process.stderr.write(
        "Reading the known accounts from public NEAR RPC. History uses NearBlocks and is spaced to stay within the free limit.\n",
      );
    }
    const index = live
      ? await crawlAgentIndex({ onProgress: (line) => process.stderr.write(`${line}\n`) })
      : await buildAgentIndexFromFiles([...FIXTURE_INDEX_PATHS]);
    mkdirSync(dirname(out), { recursive: true });
    mkdirSync(dirname(html), { recursive: true });
    writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);
    writeFileSync(html, renderIndexHtml(index));
    if (index.attribution.length > 0) process.stderr.write(`${index.attribution.join("\n")}\n`);
    process.stderr.write(`Proof strip written to ${out} and ${html}.\n`);
    return { code: 0, stdout: `${index.totals.sentence}\n`, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}

function parseRung(value: string): "risky" | "notProven" | "proven" | null {
  if (value === "risky") return "risky";
  if (value === "not-proven" || value === "not_proven") return "notProven";
  if (value === "proven") return "proven";
  return null;
}

async function auditStdin(network?: Network, anchor = false): Promise<Report> {
  const text = readFileSync(0, "utf8");
  return auditValue(JSON.parse(text) as unknown, { network, label: "stdin", anchorIntent: anchor });
}

async function runDiff(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
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
    if (arg === "--anchor" || arg === "--sign") {
      return {
        code: 2,
        stdout: "",
        stderr: "diff does not sign and does not send a transaction. Compare the two reports, then sign one of them separately if you need a signature.\n",
      };
    }
    if (arg === "--pccs" || arg === "--pccs-url") {
      return { code: 2, stdout: "", stderr: "A caller-supplied PCCS URL is not accepted.\n" };
    }
    if (arg === "--network") {
      const value = argv[index + 1];
      if (value !== "testnet" && value !== "mainnet") {
        return { code: 2, stdout: "", stderr: "--network must be testnet or mainnet.\n" };
      }
      network = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return { code: 2, stdout: "", stderr: `Unknown argument ${arg}.\n\n${usage()}\n` };
    positional.push(arg);
  }
  if (help) return { code: 0, stdout: `${usage()}\n`, stderr: "" };
  if (positional.length !== 2) return { code: 2, stdout: "", stderr: "Pass two accounts or two JSON files.\n" };
  try {
    const left = await loadTarget(positional[0] as string, network);
    const right = await loadTarget(positional[1] as string, network);
    const diff = diffReports(left, right);
    return {
      code: 0,
      stdout: json ? `${JSON.stringify(diff, null, 2)}\n` : formatDiff(diff),
      stderr: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function loadTarget(target: string, network?: Network): Promise<Report> {
  if (target === "-") return auditStdin(network);
  if (existsSync(target)) return auditFile(target, { network });
  return auditAccount(target, { network });
}

function render(report: Report, json: boolean): string {
  return json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report);
}
