import { auditTarget, presentCheck, type AgentCheck, type AuditOptions, type Network } from "core";

export interface CheckAgentInput {
  target: string;
  network?: Network;
}

/** One audit. `target` is a NEAR account, pasted JSON, or a local JSON file. */
export async function checkAgent(input: CheckAgentInput, options: AuditOptions = {}): Promise<AgentCheck> {
  const report = await auditTarget(input.target, { ...options, network: input.network ?? options.network });
  return presentCheck(report);
}
