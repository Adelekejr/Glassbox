import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  FIXTURE_INDEX_PATHS,
  buildAgentIndexFromFiles,
  crawlAgentIndex,
  defaultIndexPaths,
  renderIndexHtml,
} from "../src/index.js";

/**
 * Regenerate the proof strip.
 * `pnpm --filter core index` uses local fixtures.
 * `pnpm --filter core index -- --live` crawls the known accounts (NearBlocks, spaced).
 */
const argv = process.argv.slice(2);
let live = false;
const defaults = defaultIndexPaths();
let out = defaults.json;
let html = defaults.html;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--live") {
    live = true;
    continue;
  }
  if (arg === "--out" || arg === "--html") {
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} needs a file path.`);
    if (arg === "--out") out = value;
    else html = value;
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument ${arg}.`);
}

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
process.stdout.write(`${index.totals.sentence}\n`);
