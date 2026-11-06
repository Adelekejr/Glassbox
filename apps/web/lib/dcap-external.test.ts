import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webRoot, "../..");

test("the web app loads the same @phala/dcap-qvl build the quote check imports", () => {
  const webPkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const corePkg = JSON.parse(readFileSync(join(repoRoot, "packages/core/package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const nextConfig = readFileSync(join(webRoot, "next.config.ts"), "utf8");
  assert.equal(webPkg.dependencies["@phala/dcap-qvl"], "0.7.1");
  assert.equal(webPkg.dependencies["@phala/dcap-qvl"], corePkg.dependencies["@phala/dcap-qvl"]);
  assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*["']@phala\/dcap-qvl["']/);
  const fromWeb = realpathSync(createRequire(join(webRoot, "package.json")).resolve("@phala/dcap-qvl"));
  const fromCore = realpathSync(createRequire(join(repoRoot, "packages/core/package.json")).resolve("@phala/dcap-qvl"));
  assert.equal(fromWeb, fromCore);
});
