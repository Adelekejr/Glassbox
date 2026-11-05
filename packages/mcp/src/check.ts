import { existsSync } from "node:fs";
import { extname } from "node:path";
import { auditTarget, presentCheck, type AgentCheck, type AuditOptions, type Network } from "core";

export interface CheckAgentInput {
  target: string;
  network?: Network;
}

const MAX_TARGET_CHARS = 2_000_000;

/**
 * One audit. `target` is a NEAR account, pasted JSON, or a local `.json` file.
 * Other existing paths are rejected so a prompt cannot use this tool to read
 * arbitrary files such as keys or `.env`.
 */
export async function checkAgent(input: CheckAgentInput, options: AuditOptions = {}): Promise<AgentCheck> {
  const target = input.target.trim();
  if (target.length === 0 || target.length > MAX_TARGET_CHARS) {
    throw new Error("target must be a NEAR account id, pasted JSON, or a .json file, and must be at most 2 MB.");
  }
  if (!target.startsWith("{") && !target.startsWith("[") && existsSync(target) && extname(target).toLowerCase() !== ".json") {
    throw new Error("Local files must end in .json. Pass a NEAR account id or paste JSON text.");
  }
  const report = await auditTarget(target, { ...options, network: input.network ?? options.network });
  return presentCheck(report);
}
