import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assessAccessKeys } from "../src/checks/access-keys.js";
import { assessDstack, versionInVulnerableRange } from "../src/checks/dstack.js";
import { DCAP_QVL_VERSION, collateralUrlAllowed } from "../src/checks/pccs.js";
import { fetchFreshCollateral, proveCollateralFetchGuard } from "../src/checks/tdx.js";
import { formatExpiry } from "../src/checks/mpc.js";
import { replayRtmr } from "../src/checks/rtmr.js";
import { hardwareAndOSMeasurements } from "../src/data/shade-measurements.js";
import { matchShadeMeasurements } from "../src/data/shade-measurements.js";
import { classifyImage, isSecretEnvName, parseCompose, sha256Hex } from "../src/evidence/compose.js";
import { auditValue } from "../src/audit.js";
import { buildReport, formatReport } from "../src/report.js";
import { accountUrl, advisoryUrl, type EventLogEntry } from "../src/types.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votron-registration.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  originalAppComposeSha256: string;
  quoteHex: string;
  tcbInfo: { app_compose: string; rtmr0: string; rtmr1: string; rtmr2: string; rtmr3: string; event_log: EventLogEntry[] };
  agentId: string;
};

const FROZEN = new Date("2026-11-04T12:00:00.000Z");
const COMPOSE_HASH = "cdfac6870932559754412f5571b45818c26f93da9cf6247d919679d6960bbb78";

test("votron fixture keeps the compose-hash and drops the preimage", () => {
  assert.equal(fixture.originalAppComposeSha256, COMPOSE_HASH);
  const payload = fixture.tcbInfo.event_log.find((event) => event.event === "compose-hash")?.event_payload;
  assert.equal(payload, COMPOSE_HASH);
  assert.notEqual(sha256Hex(fixture.tcbInfo.app_compose), COMPOSE_HASH);
  assert.match(fixture.tcbInfo.app_compose, /NEAR_SEED_PHRASE/);
  assert.match(fixture.tcbInfo.app_compose, /REDACTED/);
  assert.doesNotMatch(fixture.tcbInfo.app_compose, /sk-[A-Za-z0-9]/);
});

test("votron registration report uses the real quote and stays inside the wording rules", async () => {
  const report = await auditValue(fixture, { now: FROZEN, label: "votron-fixture" });
  const text = `${formatReport(report)}\n${JSON.stringify(report)}`;
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);
  assert.match(text, /registered configuration/i);
  assert.match(text, /matches a vulnerable configuration/);
  assert.equal(report.shade, "shade-v1");
  const byId = Object.fromEntries(report.findings.map((finding) => [finding.id, finding]));
  assert.equal(byId["tdx.signature"].ladder, "PROVEN");
  assert.equal(byId["tdx.qe_identity"].ladder, "PROVEN");
  assert.match(byId["tdx.qe_identity"].plainEnglish, /mandatory/i);
  assert.equal(byId["tdx.registration"].ladder, "PROVEN");
  assert.match(byId["tdx.registration"].plainEnglish, /UpToDate/);
  assert.match(byId["tdx.registration"].plainEnglish, /registered configuration/i);
  assert.equal(byId["tdx.fresh"].ladder, "NOT_PROVEN");
  assert.equal(byId["tdx.debug"].ladder, "PROVEN");
  assert.ok(byId["tdx.advisories"]);
  assert.equal(report.verifier.package, "@phala/dcap-qvl");
  assert.equal(report.verifier.version, DCAP_QVL_VERSION);
  assert.equal(report.verifier.qeIdentity, "mandatory");
  assert.equal(report.verifier.tcbStatus, "enforced");
  assert.ok(report.verifier.pccsAllowlist.includes("https://pccs.phala.network"));
  assert.equal(byId["tdx.report_data"].ladder, "PROVEN");
  assert.match(byId["tdx.report_data"].plainEnglish, new RegExp(fixture.agentId));
  assert.equal(byId["measurements.quote_match"].ladder, "PROVEN");
  assert.equal(byId["rtmr.replay"].ladder, "PROVEN");
  assert.equal(byId["compose.hash"].ladder, "PROVEN");
  assert.match(byId["compose.hash"].plainEnglish, /REDACTED|redacted|removed/i);
  assert.equal(byId["codehash.approved"].ladder, "PROVEN");
  assert.equal(byId["measurements.approved"].ladder, "NOT_PROVEN");
  assert.equal(byId["dstack.range"].ladder, "RISKY");
  assert.equal(byId["dstack.range"].inference, true);
  assert.equal(byId["dstack.upgrade"].ladder, "RISKY");
  assert.match(byId["dstack.upgrade"].plainEnglish, /20 Nov 2026/);
  assert.match(byId["dstack.upgrade"].plainEnglish, /0\.3\.x/);
  assert.equal(byId["images.pin"].ladder, "PROVEN");
  assert.equal(byId["dstack.public_logs"].ladder, "RISKY");
  assert.equal(byId["dstack.public_sysinfo"].ladder, "RISKY");
  assert.match(byId["dstack.public_sysinfo"].evidence.map((item) => item.label).join(" "), /public_sysinfo/);
  assert.equal(byId["dstack.secret_env"].ladder, "RISKY");
  assert.equal(byId["compose.plaintext_secrets"].ladder, "PROVEN");
  assert.equal(byId["compose.sockets"].ladder, "RISKY");
  assert.match(byId["compose.sockets"].plainEnglish, /\/var\/run\/tappd\.sock/);
  assert.equal(byId["compose.kms"].ladder, "RISKY");
  assert.match(byId["compose.kms"].plainEnglish, /no encrypted env/i);
  assert.equal(byId["compose.allowed_envs"].ladder, "NOT_PROVEN");
  assert.equal(byId["compose.debug_images"].ladder, "PROVEN");
  assert.match(byId["dstack.secret_env"].plainEnglish, /NEAR_SEED_PHRASE/);
  assert.match(byId["dstack.secret_env"].plainEnglish, /ANTHROPIC_API_KEY/);
  assert.equal(byId["access.keys"].ladder, "RISKY");
  assert.match(byId["access.keys"].plainEnglish, /Full-access/);
  assert.equal(byId["mpc.allowlist"].ladder, "NOT_PROVEN");
  assert.match(byId["runtime.observed"].plainEnglish, /registered configuration/);
  assert.equal(report.attribution.length, 0);
});

test("fresh collateral errors are reported instead of being dropped", () => {
  const report = buildReport(
    {
      target: "ac-sandbox.votron.testnet",
      network: "testnet",
      shade: "shade-v1",
      shadeDetail: "fixture",
      methodsPresent: ["get_agent"],
      registration: {
        quoteHex: fixture.quoteHex,
        agentId: fixture.agentId,
        timestampSec: 1758945254,
      },
      compose: null,
      freshCollateralError: "pccs down",
      rpcEndpoints: [],
      generatedAt: FROZEN.toISOString(),
      historySource: "file",
    },
    { now: FROZEN },
  );
  const fresh = report.findings.find((finding) => finding.id === "tdx.fresh");
  assert.match(fresh?.plainEnglish ?? "", /pccs down/);
});

test("event log replay matches the registered RTMR3", () => {
  assert.equal(replayRtmr(fixture.tcbInfo.event_log, 3), fixture.tcbInfo.rtmr3);
  assert.equal(replayRtmr(fixture.tcbInfo.event_log, 0), fixture.tcbInfo.rtmr0);
});

test("votron measurements are not in the Shade 0.5.7 or 0.5.8 tables", () => {
  assert.equal(
    matchShadeMeasurements({
      rtmr0: fixture.tcbInfo.rtmr0,
      rtmr1: fixture.tcbInfo.rtmr1,
      rtmr2: fixture.tcbInfo.rtmr2,
    }),
    null,
  );
  const row = hardwareAndOSMeasurements["0.5.8"]["tdx.small"].rtmrs;
  const match = matchShadeMeasurements(row);
  assert.equal(match?.version, "0.5.8");
  assert.equal(match?.instanceType, "tdx.small");
  assert.equal(match?.mrtdMatched, true);
  assert.equal(matchShadeMeasurements({ ...row, mrtd: "ab".repeat(48) })?.mrtdMatched, false);
  for (const version of ["0.5.7", "0.5.8"] as const) {
    for (const instance of Object.values(hardwareAndOSMeasurements[version])) {
      for (const value of Object.values(instance.rtmrs)) {
        assert.equal(value.length, 96);
      }
    }
  }
});

test("dstack version boundaries and an unpinned declared 0.5.8 deployment", async () => {
  assert.equal(versionInVulnerableRange("0.3.1"), true);
  assert.equal(versionInVulnerableRange("0.5.8"), true);
  assert.equal(versionInVulnerableRange("0.6.0"), true);
  assert.equal(versionInVulnerableRange("0.5.12"), false);
  assert.equal(versionInVulnerableRange("0.6.1"), false);
  assert.equal(versionInVulnerableRange("0.3.0"), false);
  const deployment = {
    tee_config: { dstack_version: "0.5.8", public_logs: true },
    env: ["SPONSOR_PRIVATE_KEY"],
    docker_compose_file: "services:\n  app:\n    image: example/app:latest\n    environment:\n      SPONSOR_PRIVATE_KEY: not-a-real-secret\n",
  };
  const report = await auditValue(deployment, { now: FROZEN });
  const text = formatReport(report);
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /not-a-real-secret/);
  const byId = Object.fromEntries(report.findings.map((finding) => [finding.id, finding]));
  assert.equal(byId["dstack.range"].ladder, "RISKY");
  assert.match(byId["dstack.range"].plainEnglish, /0\.5\.8/);
  assert.equal(byId["dstack.range"].inference, false);
  assert.equal(byId["images.pin"].ladder, "RISKY");
  assert.match(byId["images.pin"].plainEnglish, /latest/);
  assert.equal(byId["dstack.secret_env"].ladder, "RISKY");
  assert.match(byId["dstack.secret_env"].plainEnglish, /SPONSOR_PRIVATE_KEY/);
});

test("an os image hash outside the fixed list is not called a compromise", async () => {
  const report = await auditValue(
    {
      tcb_info: {
        os_image_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        event_log: [],
      },
    },
    { now: FROZEN },
  );
  const finding = report.findings.find((item) => item.id === "dstack.range");
  assert.equal(finding?.ladder, "RISKY");
  assert.match(finding?.title ?? "", /not a known fixed image/);
  assert.equal(finding?.inference, true);
  const fixed = assessDstack({
    osImageHash: "ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6",
    hasOsImageHashEvent: true,
    hasRootfsHashEvent: false,
  });
  assert.equal(fixed.kind, "fixed");
  assert.equal(fixed.label, "dstack-0.6.1");
});

test("shade v2 compares approved measurements and keeps a dated approval history", () => {
  const zero = "0".repeat(96);
  const hash = "0".repeat(64);
  const row = {
    mrtd: zero,
    rtmr0: zero,
    rtmr1: zero,
    rtmr2: zero,
    key_provider_event_digest: zero,
    app_compose_hash_payload: hash,
  };
  const matched = buildReport(
    {
      target: "shade.test.near",
      network: "testnet",
      shade: "shade-v2",
      shadeDetail: "v2",
      methodsPresent: ["get_contract_info", "get_approved_measurements", "get_agents"],
      registration: null,
      compose: null,
      requiresTee: false,
      v2Agents: [
        {
          accountId: "agent.test.near",
          measurements: row,
          validity: "Valid",
          valid: true,
          validUntilMs: Date.parse("2030-01-01T00:00:00.000Z"),
        },
      ],
      approvedMeasurements: [row],
      approvalHistory: [
        {
          method: "approve_measurements",
          kind: "approve",
          txHash: "abc",
          signer: "owner.test.near",
          timestampIso: "2026-11-04T00:00:00.000Z",
          success: true,
          detail: "mrtd 0000000000000000…",
        },
      ],
      approvalHistoryNote: "No remove_measurements calls were in the indexed history.",
      historySource: "nearblocks",
      rpcEndpoints: [],
      generatedAt: FROZEN.toISOString(),
    },
    { now: FROZEN },
  );
  const byId = Object.fromEntries(matched.findings.map((finding) => [finding.id, finding]));
  assert.equal(byId["measurements.approved"].ladder, "PROVEN");
  assert.equal(byId["measurements.local_default"].ladder, "RISKY");
  assert.equal(byId["agent.validity"].ladder, "PROVEN");
  assert.equal(matched.overall, "RISKY");
  const text = formatReport(matched);
  assert.match(text, /Approval history/);
  assert.match(text, /approve_measurements/);
  assert.match(text, /2026-11-04T00:00:00.000Z/);
  assert.match(text, /Powered by Nearblocks.io APIs/);
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);

  const missed = buildReport(
    {
      target: "shade.test.near",
      network: "testnet",
      shade: "shade-v2",
      shadeDetail: "v2",
      methodsPresent: ["get_approved_measurements", "get_agents"],
      registration: null,
      compose: null,
      v2Agents: [
        {
          accountId: "agent.test.near",
          measurements: { ...row, mrtd: "1".repeat(96) },
          validity: "Valid",
          valid: true,
          validUntilMs: Date.parse("2030-01-01T00:00:00.000Z"),
        },
      ],
      approvedMeasurements: [row],
      rpcEndpoints: [],
      generatedAt: FROZEN.toISOString(),
    },
    { now: FROZEN },
  );
  assert.equal(missed.findings.find((finding) => finding.id === "measurements.approved")?.ladder, "RISKY");
});

test("image pins, secret names, and access keys", () => {
  assert.equal(classifyImage("repo/app@sha256:" + "ab".repeat(32)).pinned, true);
  assert.equal(classifyImage("repo/app:latest").tag, "latest");
  assert.equal(classifyImage("repo/app").implicitLatest, true);
  assert.equal(isSecretEnvName("NEAR_SEED_PHRASE"), true);
  assert.equal(isSecretEnvName("ANTHROPIC_API_KEY"), true);
  assert.equal(isSecretEnvName("SPONSOR_PRIVATE_KEY"), true);
  assert.equal(isSecretEnvName("API_CODEHASH"), false);
  assert.equal(isSecretEnvName("AWS_ACCESS_KEY_ID"), true);
  assert.equal(isSecretEnvName("PUBLIC_LOGGER"), false);
  const unlimited = assessAccessKeys([
    {
      public_key: "ed25519:example",
      access_key: {
        permission: { FunctionCall: { allowance: null, receiver_id: "app.near", method_names: [] } },
      },
    },
  ]);
  assert.equal(unlimited.ladder, "RISKY");
  assert.match(unlimited.reasons.join(" "), /any method/);
  assert.match(unlimited.reasons.join(" "), /unlimited/);
  const limited = assessAccessKeys([
    {
      public_key: "ed25519:example",
      access_key: {
        permission: { FunctionCall: { allowance: "1000", receiver_id: "app.near", method_names: ["get_agent"] } },
      },
    },
  ]);
  assert.equal(limited.ladder, "PROVEN");
  const parsed = parseCompose("services:\n  app:\n    image: nginx:1.25\n");
  assert.equal(parsed?.images[0]?.pinned, false);
  assert.equal(parsed?.images[0]?.tag, "1.25");
});

test("a quote that does not verify is not marked proven", async () => {
  const copy = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  copy.collateral = { not: "collateral" };
  const report = await auditValue(copy, { now: FROZEN, label: "bad-collateral" });
  const byId = Object.fromEntries(report.findings.map((finding) => [finding.id, finding]));
  assert.equal(byId["tdx.signature"].ladder, "NOT_PROVEN");
  assert.equal(byId["tdx.qe_identity"].ladder, "NOT_PROVEN");
  assert.equal(byId["tdx.registration"].ladder, "NOT_PROVEN");
  assert.equal(byId["tdx.advisories"].ladder, "NOT_PROVEN");
  assert.equal(byId["tdx.debug"].ladder, "NOT_PROVEN");
  assert.equal(byId["tdx.report_data"].ladder, "NOT_PROVEN");
  assert.equal(byId["measurements.quote_match"].ladder, "NOT_PROVEN");
  assert.doesNotMatch(byId["measurements.quote_match"].plainEnglish, /verified quote/i);
  assert.doesNotMatch(formatReport(report), /hacked/i);
});

test("malformed quote hex and an unreadable timestamp do not throw", async () => {
  const odd = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  odd.quoteHex = "abc";
  const oddReport = await auditValue(odd, { now: FROZEN });
  assert.equal(oddReport.findings.find((finding) => finding.id === "tdx.registration")?.ladder, "NOT_PROVEN");

  const huge = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  huge.blockTimestampNs = "9".repeat(80);
  const hugeReport = await auditValue(huge, { now: FROZEN });
  assert.ok(hugeReport.findings.length > 0);
  assert.equal(formatExpiry({ image_hash: "ab", expiry_timestamp_seconds: 1e20 }), "unreadable expiry");
});

test("evidence links keep their host when the id contains URL characters", () => {
  for (const id of ["INTEL-SA-01192", "../x", "https://evil.example"]) {
    assert.equal(new URL(advisoryUrl(id)).host, "www.intel.com");
  }
  assert.equal(
    advisoryUrl("INTEL-SA-01192"),
    "https://www.intel.com/content/www/us/en/security-center/advisory/intel-sa-01192.html",
  );
  const account = new URL(accountUrl("testnet", "acct.testnet/../../evil.example"));
  assert.equal(account.host, "testnet.nearblocks.io");
  assert.match(account.pathname, /%2F/);
});

test("a declared fixed version is not proven without an os_image_hash", async () => {
  const declared = await auditValue(
    { tee_config: { dstack_version: "0.6.1", public_logs: false } },
    { now: FROZEN },
  );
  const finding = declared.findings.find((item) => item.id === "dstack.range");
  assert.equal(finding?.ladder, "NOT_PROVEN");
  assert.equal(finding?.inference, true);
  assert.doesNotMatch(finding?.title ?? "", /is a fixed image/);
  assert.match(finding?.plainEnglish ?? "", /os_image_hash/);
  const upgrade = declared.findings.find((item) => item.id === "dstack.upgrade");
  assert.equal(upgrade?.ladder, "NOT_PROVEN");

  const mismatched = await auditValue(
    {
      tcb_info: {
        os_image_hash: "ab".repeat(32),
        event_log: [],
        app_compose: JSON.stringify({ dstack_version: "0.6.1" }),
      },
    },
    { now: FROZEN },
  );
  const hashed = mismatched.findings.find((item) => item.id === "dstack.range");
  assert.equal(hashed?.ladder, "RISKY");
  assert.match(hashed?.title ?? "", /not a known fixed image/);
  assert.match(hashed?.plainEnglish ?? "", /0\.6\.1/);
  assert.match(hashed?.plainEnglish ?? "", /not used in place of the os_image_hash/);

  const matched = assessDstack({
    osImageHash: "ec43cb8c5e04b6bb6c53b33b16076a01d83d01f7f4b703f2f78a0d947d6247e6",
    compose: {
      publicLogs: null,
      publicSysinfo: null,
      kmsEnabled: null,
      hasEncryptedEnv: false,
      allowedEnvs: null,
      dstackVersion: "0.5.8",
      versionDeclared: true,
      envNames: [],
      secrets: [],
      images: [],
      socketMounts: [],
      referencesTappdSocket: false,
      hasDockerCompose: false,
    },
    hasOsImageHashEvent: true,
    hasRootfsHashEvent: false,
  });
  assert.equal(matched.kind, "fixed");
  assert.match(matched.detail, /os_image_hash matches/);
});

test("compose hygiene flags plaintext secrets without copying the value", async () => {
  const canary = "sk-ant-not-a-real-secret-value";
  const report = await auditValue(
    {
      kms_enabled: false,
      public_sysinfo: true,
      allowed_envs: ["*", "NEAR_SEED_PHRASE"],
      pre_launch_script: "export AWS_ACCESS_KEY_ID=AKIAFAKEKEY123456\nexport OTHER=$DSTACK_OTHER\n",
      docker_compose_file: [
        "services:",
        "  app:",
        "    image: example/app:debug",
        "    environment:",
        `      ANTHROPIC_API_KEY: ${canary}`,
        "      NEAR_SEED_PHRASE: ${NEAR_SEED_PHRASE}",
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock",
        "      - /var/run/tappd.sock:/var/run/tappd.sock",
      ].join("\n"),
    },
    { now: FROZEN },
  );
  const text = `${formatReport(report)}\n${JSON.stringify(report)}`;
  assert.doesNotMatch(text, /hacked/i);
  assert.doesNotMatch(text, /currently running/i);
  assert.doesNotMatch(text, /compromised/i);
  assert.doesNotMatch(text, /pwned/i);
  assert.equal(text.includes(canary), false);
  assert.equal(text.includes("AKIAFAKEKEY123456"), false);
  const byId = Object.fromEntries(report.findings.map((finding) => [finding.id, finding]));
  assert.equal(byId["compose.plaintext_secrets"].ladder, "RISKY");
  assert.match(byId["compose.plaintext_secrets"].plainEnglish, /ANTHROPIC_API_KEY/);
  assert.match(byId["compose.plaintext_secrets"].plainEnglish, /AWS_ACCESS_KEY_ID/);
  assert.match(byId["compose.plaintext_secrets"].plainEnglish, new RegExp(sha256Hex(canary).slice(0, 4)));
  assert.match(byId["compose.plaintext_secrets"].evidence.map((item) => item.detail ?? "").join(" "), /pre_launch_script|docker_compose_file/);
  assert.equal(byId["dstack.public_sysinfo"].ladder, "RISKY");
  assert.equal(byId["images.pin"].ladder, "RISKY");
  assert.equal(byId["compose.sockets"].ladder, "RISKY");
  assert.match(byId["compose.sockets"].plainEnglish, /docker\.sock/);
  assert.match(byId["compose.sockets"].plainEnglish, /tappd\.sock/);
  assert.equal(byId["compose.kms"].ladder, "RISKY");
  assert.match(byId["compose.kms"].plainEnglish, /kms_enabled is false/);
  assert.equal(byId["compose.allowed_envs"].ladder, "RISKY");
  assert.match(byId["compose.allowed_envs"].plainEnglish, /NEAR_SEED_PHRASE/);
  assert.equal(byId["compose.debug_images"].ladder, "RISKY");
  assert.match(byId["compose.debug_images"].plainEnglish, /example\/app:debug/);
});

test("PCCS collateral fetches stay on the hardcoded allowlist", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const installed = require("@phala/dcap-qvl/package.json") as { version: string };
  assert.equal(installed.version, DCAP_QVL_VERSION);
  assert.equal(collateralUrlAllowed("https://pccs.phala.network/sgx/certification/v4/qe/identity"), true);
  assert.equal(collateralUrlAllowed("https://api.trustedservices.intel.com/sgx/certification/v4/rootcacrl"), true);
  assert.equal(collateralUrlAllowed("https://user:pass@pccs.phala.network/"), false);
  assert.equal(collateralUrlAllowed("http://pccs.phala.network/"), false);
  assert.equal(collateralUrlAllowed("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(collateralUrlAllowed("https://example.com/"), false);
  await assert.rejects(
    () => fetchFreshCollateral(fixture.quoteHex, "https://example.com/" as never),
    /not accepted/,
  );
  await proveCollateralFetchGuard(fixture.quoteHex);
  const poisoned = await auditValue(
    { ...fixture, pccsUrl: "http://169.254.169.254/latest/meta-data", pccs_url: "https://evil.example/pccs" },
    { now: FROZEN, label: "pccs-poison" },
  );
  const dumped = JSON.stringify(poisoned);
  assert.equal(dumped.includes("169.254.169.254"), false);
  assert.equal(dumped.includes("evil.example"), false);
  assert.match(formatReport(poisoned), /@phala\/dcap-qvl 0\.7\.1/);
  assert.match(formatReport(poisoned), /caller URLs are not accepted/);
});
