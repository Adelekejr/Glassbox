# Glassbox

Free, open-source (MIT) public auditor for AI-agent contracts on NEAR. Entered in the NEAR Hackathon, Security track.

Glassbox takes a NEAR account, or a pasted registration / app-compose / deployment JSON file, and prints one report. Every finding sits on a ladder: **PROVEN**, **NOT PROVEN**, or **RISKY**. Each line is plain English and, where a chain fact exists, links to it. The tool does not send transactions. It can sign a report file on your computer. That key stays on that computer.

It does not judge whether a payment is correct. That is [Gideon](#gideon), a separate project by the same builder.

## Do this

- Do install and test — see `pnpm install` then `pnpm test` (Node 20+).
- Do audit the captured votron registration on testnet — see `pnpm --filter cli start ac-sandbox.votron.testnet`.
- Do print the same report as JSON — see `pnpm --filter cli start ac-sandbox.votron.testnet --json`. `--json` stays that report when you also pass `--sign`.
- Do audit a file offline — see `node packages/cli/bin/glassbox.js packages/core/test/fixtures/votron-registration.json` from the repo root, or pass any registration, app-compose, or deployment JSON. Add `--json` for the machine report.
- Do sign a report — see `--sign`. The signed file is `report.json` unless you pass `--out`.
- Do check a signed report — see `glassbox verify report.json`.
- Do gate a compose in CI — see `--fail-on risky` and `.github/workflows/compose-hygiene.yml`.
- Do rebuild the proof strip — see `glassbox index` (local files) or `glassbox index --live` (the known accounts).
- Do smoke the other public targets — see `pnpm smoke`.
- Do run the MCP server — see `packages/mcp/README.md`. The tool is `check_agent`.
- Do open the local web form — see `pnpm --filter web dev`, then http://localhost:3000. It is not deployed.
- Do read how a finding is decided — see `packages/core/src/report.ts`.
- Do read how chain data is loaded — see `packages/core/src/audit.ts`.
- Do read the wording rules before editing copy — see `HANDOFF.md`.
- Do read dependency credits — see `NOTICE`.

`ac-sandbox.votron.testnet` is the account suffix rule: `.testnet` selects testnet, `.near` selects mainnet. An account with neither suffix (such as `v1.signer`) is tried on mainnet, then testnet.

The first live read spends about half a minute. History comes from NearBlocks, and Glassbox waits between those calls so it stays inside the free personal-use limit (about 6 per minute).

## What the ladder means

| Ladder | Meaning in Glassbox |
| --- | --- |
| PROVEN | A direct check succeeded: a signature verified, two hashes were equal, or a view returned the value named in the sentence. |
| NOT PROVEN | The evidence was missing, the index may be incomplete, or the question is outside what a registration can show. This is not a pass. |
| RISKY | The registered configuration, or the account's keys, matched a concrete risk named in the sentence. |

The report also names the highest rung already on the ladder. That line is not a separate check. The counts stay the table of contents.

### Proven for `ac-sandbox.votron.testnet` (live, 2026-11-04)

- The registration quote verifies against the collateral stored in transaction `HczqYXdRBZfyTtnQiPqGRXe3zEhvwHu3hyCUkqMq8VjN`. TCB status at registration (2025-09-27) is UpToDate. Debug bit is clear. Report data is the registering account id.
- Quote MRTD and RTMR0–RTMR3 equal the registered `tcb_info`. Replaying the event log reproduces RTMR0–RTMR3. `sha256` of the registered app compose equals the compose-hash event `cdfac687…`.
- Both images are pinned by digest. `get_agent` codehash `2a2f4704…` matches an `approve_codehash` transaction. That codehash is the app image digest, not a TDX measurement.

### Not proven

- Shade v1 has no view of approved TDX measurements. The codehash check does not fill that gap.
- The pinned image digests are not on `allowed_docker_image_hashes` at `v1.signer` (mainnet) or `v1.signer-prod.testnet`. That list is a different system. See [dreyyyy1/measure](https://github.com/dreyyyy1/measure). Absence is not a judgement of the Shade registration.
- Glassbox did not observe what the account is executing now. Phala blocks public guest-agent routes by default. A registration is not a live process.

### Risky

- Fresh collateral from `https://pccs.phala.network` puts the same registered quote at TCB status OutOfDate, with Intel advisory IDs INTEL-SA-01192, INTEL-SA-01245, INTEL-SA-01312, INTEL-SA-01313, and INTEL-SA-01367.
- The registered configuration matches a vulnerable configuration: no `os-image-hash` event, a `rootfs-hash` event, and `/var/run/tappd.sock`. That is a heuristic for dstack before 0.5, inside the range 0.3.1–0.6.0. It is not an exact version, and it is not a claim that the guest was broken into.
- `public_logs` is true. Env names `NEAR_SEED_PHRASE` and `ANTHROPIC_API_KEY` look like secrets. Values are not printed. On this registration the values in the compose are `${NAME}` references, not literals.
- The account has a full-access key, so the registered policy is not locked.
- Phala's 19 Oct 2026 post-mortem: move to 0.6.1 or 0.5.12 by 19 Nov 2026. From 20 Nov 2026, remaining 0.5.x and 0.6.0 CVMs are auto-upgraded, and 0.3.x is retired with no upgrade path (enterprise excluded). A pre-0.5 heuristic cannot tell those cases apart. Shade v1's codehash approval is not cleared by an OS image change; a 0.3.x guest can still be retired by the operator. On Shade v2, new measurements will not match `get_approved_measurements` until the owner approves them.

Source for the guest-agent issue: https://phala.com/posts/2026-10-post-mortem-dstack-guest-agent-vulnerability

## Sample

`pnpm --filter cli start ac-sandbox.votron.testnet` printed this shape on 2026-11-04 (the command prints every finding; this is the head of that report):

```
Glassbox report
Target:     ac-sandbox.votron.testnet
Network:    testnet
Interface:  shade-v1

Summary: 6 risky, 3 not proven, 9 proven.
This report describes the registered configuration. It does not establish what the account is executing now.

RISKY
1. Access keys can change or broadly call the account
   Full-access key ed25519:F7jZEsyZ2kr8qCddBY2F44DryGMFDy5i4xkkMMDu9Fep. ...
5. 20 Nov 2026 auto-upgrade or v0.3.x retirement may apply
   ... Marked as an inference.
6. Fresh collateral TCB status is OutOfDate
   ... Advisory IDs: INTEL-SA-01192, INTEL-SA-01245, INTEL-SA-01312, INTEL-SA-01313, INTEL-SA-01367.

NOT PROVEN
1. No on-contract list of approved TDX measurements
3. What the account is executing now was not observed

PROVEN
8. Registration quote verifies
   The registration quote verifies. TCB status at registration (2025-09-27T03:54:14.000Z) is UpToDate.

Powered by Nearblocks.io APIs.
```

## Signed reports

`--sign` writes a signed report next to the human text. `--json` still prints the report itself.

```bash
node packages/cli/bin/glassbox.js packages/core/test/fixtures/votron-registration.json --sign --out report.json
node packages/cli/bin/glassbox.js verify report.json --offline
```

The file holds the inputs (contract, agent, transaction, block height, collateral source and fetch time, Glassbox version, and `@phala/dcap-qvl`), the checks, and the verdict. It also holds the sha256 of that body and an ed25519 signature.

The first `--sign` creates a key at `~/.config/glassbox/report-signing-key.pem` (or `GLASSBOX_SIGNING_KEY` if you set that path). A second file beside it, ending in `.pub`, is the public key in hex. Keep the private file to yourself. Do not commit it.

`verify` checks the hash and the signature. When the report names a transaction, it reads that transaction again from the archival RPC. `.testnet` selects testnet. `.near` selects mainnet. An account with neither suffix uses the network recorded in the report. `--offline` checks the hash and signature only, which is how the saved votron file is checked without the network.

Fresh collateral, access keys, and the MPC allowlists can change after the report is signed. Verify leaves those as they were signed and recomputes the registration checks.

Anchoring the report hash on NEAR is a later opt-in. This build does not create an account and does not send a transaction. `GLASSBOX_ANCHOR=1` only records that you asked. It still sends nothing.

## MCP

Do install it for an agent owner — see `packages/mcp/README.md` for Claude Desktop and Cursor snippets.

`check_agent` takes a NEAR account or pasted JSON. It returns the same ladder as JSON, a one-sentence summary, and `overall` (the highest rung). Stdio transport. From this repo, before the package is published:

```bash
node packages/mcp/bin/glassbox-mcp.js
```

The package is not on npm yet. Do not publish it from this repo unless you mean to. After it is published, the one-liner is:

```bash
npx -y glassbox-mcp
```

Cursor (`.cursor/mcp.json`) and Claude Desktop, once the package is published:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "npx",
      "args": ["-y", "glassbox-mcp"]
    }
  }
}
```

From this checkout, before that publish, point the command at `node` and `packages/mcp/bin/glassbox-mcp.js`. The same JSON shape is in `packages/mcp/README.md`.

`check_agent` accepts a NEAR account id or JSON text. It refuses a URL, and it refuses a caller-supplied collateral host. A burst of calls in one process is limited to about six a minute.

A live `check_agent` on `ac-sandbox.votron.testnet` on 2026-11-04 returned `overall: RISKY`, shade v1, 6 risky / 3 not proven / 9 proven, and an approval-history list of `approve_codehash` calls dated from August 2025. No `remove_codehash` calls were in the index. The response includes `Powered by Nearblocks.io APIs.`

## Compose check

[![Glassbox check](https://img.shields.io/badge/glassbox%20check-local%20compose-2ea44f)](https://github.com/Adelekejr/Glassbox/blob/main/.github/workflows/compose-hygiene.yml)

There is no hosted report API, so the badge above is a static shields.io image. After the workflow is on the default branch of a public repo, a status badge can use:

```
https://img.shields.io/github/actions/workflow/status/Adelekejr/Glassbox/compose-hygiene.yml?branch=main&label=glassbox%20check
```

The Action runs `glassbox check fixtures/compose/pinned.json --fail-on risky`. That file is a pinned compose. It does not call a chain. The job fails when the audit has a risky finding. `fixtures/compose/loose.json` is the example that fails the gate (unpinned image, public logs, a socket mount).

```bash
node packages/cli/bin/glassbox.js check fixtures/compose/pinned.json --fail-on risky
```

## Proof strip

The web form shows one line: how many agents were scanned, how many are proven, how many match a vulnerable configuration, and how many are not proven. Not proven is not a clean result.

Rebuild it from the local fixtures (no NearBlocks calls):

```bash
node packages/cli/bin/glassbox.js index
```

The same command is `pnpm --filter core index`. It writes `apps/web/data/proof-strip.json` and `apps/web/public/proof-strip.html`.

To read the known accounts, which does call NearBlocks and waits between calls (about 6 a minute):

```bash
node packages/cli/bin/glassbox.js index --live
```

That crawl includes the testnet accounts `ac-sandbox.votron.testnet`, `ac-sandbox.ajitesh-1.testnet`, `ac-sandbox.nova-shade-agent.testnet`, `ac-sandbox.leo-leo-leo.testnet`, and `ac-proxy.leo-leo-leo.testnet`, plus the mainnet accounts `reflect-adam-mainnet-agent-contract.near` and `ironshield.near`. It reads `register_agent`, and `register_worker` for a worker proxy. The saved index prints `Powered by Nearblocks.io APIs.` when NearBlocks was used. Secret values are left out. The row shows the configuration class and redacted evidence.

Try the mainnet accounts, then check a signed report. These commands read public data. They do not send a transaction.

```bash
pnpm --filter cli start reflect-adam-mainnet-agent-contract.near
pnpm --filter cli start ironshield.near --sign --out report.json
node packages/cli/bin/glassbox.js verify report.json
```

## Web

Do run the form locally — see `pnpm --filter web dev`. Paste an account (the hint names testnet or mainnet from the suffix) or JSON. The page POSTs to `/api/audit`, which calls the core library. The top of the page is the proof strip. Styling is plain on purpose. Do not deploy it in this repo state.

## Shade v2

Do run the local sandbox test — see `packages/core/test/shade-v2.sandbox.test.ts`. It starts a local NEAR sandbox, deploys `shade-contract-template` from NearDeFi/shade-agent-framework commit `35758f3` (Apache-2.0 wasm in `packages/core/test/fixtures/`), approves the local-mode measurements, registers an agent, and audits that RPC. No testnet transaction. The registered measurements match `get_approved_measurements`. They are the all-zero local-mode default, which the report marks as not a TDX measurement.

## Approval history

Do read the dated approve/remove section — see the "Approval history" block in `formatReport` (`packages/core/src/report.ts`). For one contract, Glassbox asks NearBlocks for the approve and remove methods that match the interface (`approve_codehash` / `remove_codehash`, or `approve_measurements` / `remove_measurements` / ppids). Results are cached in memory for 10 minutes. It is not a watcher.

## Layout

| Path | Role |
| --- | --- |
| `packages/core` | Audit library. `pnpm --filter core test` runs the fixture tests. |
| `packages/cli` | `glassbox <account-or-file>`. `start` is the command above. |
| `packages/mcp` | `check_agent` over stdio. Bin `glassbox-mcp`. Not published. |
| `apps/web` | Local form and the proof strip. Not deployed. |
| `packages/core/test/fixtures/votron-registration.json` | Redacted capture of the votron `register_agent` arguments. |
| `packages/core/scripts/smoke.ts` | Live read of the other public targets. |

## Sources

Chain reads use free public endpoints, FastNEAR first and `near.org` as fallback: `rpc.testnet.fastnear.com`, `rpc.mainnet.fastnear.com`, and the matching `rpc.*.near.org` hosts. Old transactions use `archival-rpc.testnet.fastnear.com` (near.org archival is the fallback). Calls are spaced.

History: FastNEAR's tx index (`tx.test.fastnear.com` / `tx.main.fastnear.com` `/v0/account`) returned HTTP 404 on 2026-11-04, so Glassbox uses the NearBlocks API and prints "Powered by Nearblocks.io APIs" when it does. NearBlocks' free tier is personal use.

TDX quotes: `@phala/dcap-qvl` 0.7.1 (Apache-2.0). That build is after the QE-identity fix in 0.3.9 (GHSA-796p-j2gh-9m2q) and the JavaScript CRL fix in 0.5.3. The report states this version. QE identity, the quote signature, TCB status at registration, TCB status now, the debug bit, and advisory IDs are separate checks. TCB status is a verdict: anything other than UpToDate is risky. Fresh collateral is fetched only from the hardcoded allowlist (`https://pccs.phala.network`, plus Intel collateral hosts the library may contact). A caller-supplied PCCS URL is rejected.

Registered app-compose hygiene (each risky when it matches, with an evidence path): plaintext secret values (name and a 4-character sha256 prefix only), `public_logs` / `public_sysinfo`, images not pinned by sha256, `docker.sock` / `tappd.sock` / `dstack.sock` mounts, `kms_enabled: false` or no encrypted env, overly broad `allowed_envs`, and debug or dev images. Credits: `NOTICE`.

dstack fixed image hashes, checked 2026-11-04: dstack-0.5.12 `8db40cb2…`, dstack-dev-0.5.12 `e866e987…`, dstack-nvidia-0.5.12 `91fd5d69…`, dstack-nvidia-dev-0.5.12 `e0c9312d…`, dstack-0.6.1 `ec43cb8c…`. A declared `dstack_version` is not a proven fixed image; the `os_image_hash` is the comparison when it is present. Shade's Apache-2.0 tables cover only dstack 0.5.7 and 0.5.8 (`shade-agent-cli/src/utils/measurements.js`).

MPC allowlists: view `allowed_docker_image_hashes` on `v1.signer` (mainnet) and `v1.signer-prod.testnet`. `v1.signer.testnet` does not exist.

## Public targets exercised

| Account | What it is |
| --- | --- |
| `ac-sandbox.votron.testnet` | Shade v1, own code. Registration above. |
| `ac-sandbox.ajitesh-1.testnet` | Shade v1, own code. |
| `ac-sandbox.nova-shade-agent.testnet` | Global contract `GMXJXnVK9vYd7CSYPtbA56rPau2h5J4YjsSsCfegGi4G`. |
| `ac-sandbox.leo-leo-leo.testnet` | Global contract `31x2yS1DZHUjMQQFXPBjbfojb4FQ8pBaER39YoReTpJb`. |
| `ac-proxy.leo-leo-leo.testnet` | Worker proxy, global contract `2pSLLgLnAM9PYD7Rj6SpdK9tJRz48GQ7GrnAXK6tmm8u`. |
| `worker.outlayer.testnet` | `get_approved_measurements`. Not Shade v2 (`get_contract_info` is absent). RTMR1 `a7b52327…` is in neither Shade table. |
| `v1.signer-prod.testnet` and `v1.signer` | MPC docker allowlists. Two hashes each; one hash expires 5 Nov 2026 (testnet) and 6 Nov 2026 (mainnet). |
| `reflect-adam-mainnet-agent-contract.near` | Mainnet demo account. `.near` selects mainnet. |
| `ironshield.near` | Mainnet demo account. `.near` selects mainnet. |

No test account found here is Shade v2. A v2 report needs `get_contract_info` / `get_approved_measurements` from a deployment the owner accepts, or from the framework's local sandbox. The account the notes call "1prime" was not located.

## Gideon

Gideon is a NEAR pre-send safety checker by the same builder (Adelekejr). Hackathon screening question Q-015 asks for that sibling to be named. Glassbox audits how an agent was registered and which keys can change the account. Gideon is the tool that checks a payment before it is sent. They do not share a verdict.

## Licence

MIT, copyright 2026 Adelekejr. See `LICENSE`. Apache-2.0 dependencies keep their notices in `NOTICE`.
