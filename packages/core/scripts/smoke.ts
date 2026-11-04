import { auditAccount, formatReport } from "../src/index.js";

/**
 * Live read of the public testnet targets from the day-1 notes, plus the
 * mainnet MPC account v1.signer. This script is not part of `pnpm test`.
 */
const targets = [
  "ac-sandbox.votron.testnet",
  "ac-sandbox.ajitesh-1.testnet",
  "ac-sandbox.nova-shade-agent.testnet",
  "ac-sandbox.leo-leo-leo.testnet",
  "ac-proxy.leo-leo-leo.testnet",
  "worker.outlayer.testnet",
  "v1.signer-prod.testnet",
  "v1.signer",
];

let failed = 0;
for (const target of targets) {
  process.stderr.write(`\n--- ${target} ---\n`);
  try {
    const report = await auditAccount(target);
    const risky = report.findings.filter((finding) => finding.ladder === "RISKY").map((finding) => finding.id);
    process.stdout.write(
      `${target}  ${report.shade}  risky=${report.summary.risky} not_proven=${report.summary.notProven} proven=${report.summary.proven}\n`,
    );
    if (risky.length) process.stdout.write(`  risky: ${risky.join(", ")}\n`);
    if (process.env.GLASSBOX_SMOKE_FULL === "1" && target === "ac-sandbox.votron.testnet") {
      process.stdout.write(formatReport(report));
    }
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${target}  ERROR  ${message}\n`);
  }
}

process.exit(failed > 0 ? 1 : 0);
