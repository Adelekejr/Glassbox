# Glassbox security audit

The delta review of product adds 1–6 (commit `18b276d`) is in [SECURITY-AUDIT-DELTA.md](SECURITY-AUDIT-DELTA.md). This file is the earlier pass (PR #3) and stays as that record.

Date: 2026-11-05. Scope: this repository (`packages/core`, `packages/cli`, `packages/mcp`, `apps/web`) and the lockfile that `pnpm install --frozen-lockfile` installs. The site was not restyled. This pass did not change GitHub repository visibility. No secrets were added.

This is a review of our code and dependencies. It does not describe an attack against any third-party service, and it does not claim that a live target was broken into.

The dependency counts in section 9 are an earlier pass on the same calendar day. The re-run is [Dependency audit re-run](#dependency-audit-re-run-2026-11-05t222543z). Do not quote section 9 as that re-run. Open findings 1–8 were not re-tested as code in the re-run. PR #12 (`eec040a`) later recorded finding provenance, stopped MCP from reading local files, and added deployment-wide audit admission.

## How this was checked

- Read the audit path from the web route, MCP tool, and CLI into `auditTarget` / `buildReport`, plus quote verification, history fetches, and report rendering.
- Searched the worktree and every blob in `git rev-list --all` (3 commits, 420 blobs) for private-key blocks, `AKIA…`, `ghp_`, `github_pat_`, Slack tokens, `sk-` / `sk-ant-` tokens, npm tokens, JWTs, and long `ed25519:` secrets. No matches.
- Classified secret-looking fields in `packages/core/test/fixtures/votron-registration.json` by shape only. The compose salt is the literal `REDACTED`. Env values that look like keys are `${…}` or `$VAR` references, including the `pre_launch_script` exports of `$DSTACK_AWS_*`.
- `pnpm audit` (pnpm 10.33.4, Node 22.23.4) against the lockfile. Advisories below are from that report and the GitHub advisory text. Versions are the ones the lockfile installed.
- `pnpm licenses list` for copyleft.
- Tests after the fixes: `pnpm --filter core test` (17, including the local sandbox), CLI tests, MCP tests, `apps/web/lib/*.test.ts`, and `pnpm run typecheck`.
- HTTP checks against `pnpm --filter web dev` on 127.0.0.1: a filesystem path is refused, a small JSON document returns a report, and the 11th audit in a minute returns HTTP 429.

## Fixed in this pull request

| Severity | Issue | Evidence | What changed |
| --- | --- | --- | --- |
| High | The web route called `auditTarget`, which reads any path that exists on disk (`existsSync` then `readFileSync`). A request whose `target` was an existing file was audited as that file. Names that look like NEAR accounts (`package.json`, `notes.md`) collide with files. | `packages/core/src/audit.ts:96` (still true for CLI and MCP). The web route no longer calls it: `apps/web/app/api/audit/route.ts`. | `/api/audit` accepts only a NEAR account id (nomicon grammar, 2–64 chars) or JSON text. Paths are HTTP 400. |
| High | Quote fields were marked **PROVEN** before signature verification. `verifyQuoteAt` parsed the quote, and on a failed `QuoteVerifier.verify` it still returned the debug bit, report data, and measurements. `buildReport` could then say the debug bit was clear, that report data bound the account, and that measurements came from "the verified quote". | `packages/core/src/report.ts:263` now requires `stored.ok`. `packages/core/src/checks/tdx.ts` returns no parsed fields when parsing or verification fails. | A quote that does not verify yields **NOT PROVEN** for the debug bit, report data, and measurement match. A verified quote is unchanged (the votron fixture still has those three as **PROVEN**). |
| Medium | A malformed quote, or a timestamp `Date` cannot represent, aborted the whole report (`quoteBytes` / `Quote.parse` threw outside the verifier `try`, and `toISOString` throws on an out-of-range time). | `packages/core/src/checks/tdx.ts`, `packages/core/src/types.ts` (`isoFromUnixMs`, `nsToSeconds`). | Those inputs finish as **NOT PROVEN** or an omitted timestamp. Quote hex is capped at 256 KiB of bytes and must be hex. Nanosecond strings longer than 20 digits are ignored. |
| Medium | MCP `check_agent` read any existing path, including keys and `.env`, and returned the audit to the model. | `packages/mcp/src/check.ts:22` | Existing paths must end in `.json`. Account ids and pasted JSON are unchanged. The tool schema rejects empty and >2 MB strings. |
| Medium | `/api/audit` had no body cap and no rate limit, so one process could spend the NearBlocks budget and hold the paced RPC client. | `apps/web/app/api/audit/route.ts`, `apps/web/lib/limit.ts` | Bodies over ~2 MB are refused. The process accepts 10 audits per rolling minute, then HTTP 429. This is not a multi-instance limit. |
| Low | Account ids, tx hashes, and advisory ids were concatenated into `https://` links without encoding. | `packages/core/src/types.ts:229` | `encodeURIComponent` on the path segment. Normal NEAR ids and `INTEL-SA-…` links are unchanged. |
| Low | The NearBlocks history cache never evicted other keys, so a long-lived process grew without a bound. | `packages/core/src/near/history.ts:38` | Cap of 200 entries. The 10-minute TTL is unchanged. |
| Low | `.gitignore` ignored `.env` but not common key filenames. | `.gitignore` | Ignores `*.pem`, `*.key`, `id_rsa`, `*.p12`, `*.pfx`. |

## Open findings

### Medium

**1. A declared `dstack_version` of 0.5.12 or 0.6.1 is **PROVEN** "a fixed image" with `inference: false`, even when no `os_image_hash` was compared.**

Evidence: `packages/core/src/checks/dstack.ts:86` returns `kind: "fixed"`. `packages/core/src/report.ts:704` titles that kind "Registered configuration is a fixed image" and copies `inference` from the assessment (here `false`). The detail sentence does say the version was declared and that no `os_image_hash` was present. The title and the rung overstate that.

Recommendation: do not use the `fixed` kind for a declared string. Keep **PROVEN** for an `os_image_hash` that is on the fixed list. For a declared version only, use **NOT PROVEN** (or **PROVEN** with `inference: true` and a title that says the configuration declares the version).

**2. A `glassbox-capture` JSON file is trusted for every non-cryptographic **PROVEN** row.**

Evidence: `packages/core/src/audit.ts:511` (`bundleFromCapture`) copies `accessKeys`, `approvedCodehashes`, `agentView`, `mpcAllowlists`, and `shade` from the file. `codehash.approved` (`packages/core/src/report.ts` `codehashFinding`) and `access.keys` then compare those fields to each other. The interface sentence says chain state was not re-read. The individual rungs still say **PROVEN**.

Quote verification is different: it still goes through `@phala/dcap-qvl`, which pins `TRUSTED_ROOT_CA_DER` (`QuoteVerifier` in `@phala/dcap-qvl` 0.7.1 `src/verify.js`). Attacker-chosen collateral that does not chain to that root does not verify. That part held in the new unit test (bad collateral → registration **NOT PROVEN**).

Recommendation: when `historySource === "file"`, either downgrade access-key, codehash, and MPC comparisons, or start those sentences with "The capture file says". Leave signature checks as they are.

**3. MCP can still read any `.json` file the process can read, including via `..` and symlinks.**

Evidence: `packages/mcp/src/check.ts`. The fixture test passes an absolute `.json` path on purpose.

Recommendation: if the tool should not be a file reader, accept only account ids and pasted JSON. If local files stay, confine them to a root directory the operator sets, and reject symlinks that resolve outside it. The CLI can keep unrestricted file reads, because the operator passed the path.

**4. The web API is still an unauthenticated proxy to public RPC, NearBlocks, and Phala PCCS if it is ever exposed.**

Evidence: `apps/web/app/api/audit/route.ts`. At the time of this pass, `apps/web/README.md` said not to deploy. This pull request did not deploy it. The public demo and the admission modes are recorded in the re-run note at the top of this file.

The new limit is 10 requests per minute inside one Node process. It resets on restart, it is not shared across instances, and a client that omits `Content-Length` is only stopped after Next has buffered the body (the target string is then capped at 2 MB). One accepted account audit still performs the paced NearBlocks reads inside that one request.

Recommendation: keep it on localhost. If it is deployed later, put authentication and a gateway limit in front, and do not treat the in-process counter as that control.

### Low

**5. The CLI prefers a local file when the argument is an existing path.**

Evidence: `packages/cli/src/run.ts:63`. An account id that happens to match a filename in the current directory (`package.json`, `notes.md`) is audited as the file. That matches the CLI's documented file mode. It is surprising when the name is also a legal account id.

Recommendation: require a `./` prefix or `--file` before reading a path that also matches the account-id grammar.

**6. Outbound `fetch` follows redirects. Fresh collateral can GET a CRL URL taken from a certificate the PCCS response supplied.**

Evidence: `packages/core/src/near/rpc.ts` and `packages/core/src/near/history.ts` call `fetch` with no `redirect` mode. `packages/core/src/checks/tdx.ts` calls `getCollateral(PHALA_PCCS_URL, …)`. In `@phala/dcap-qvl` 0.7.1 `src/collateral.js`, PCK and TCB URLs are built from that fixed host plus a hex FMSPC. If the PCCS root-CRL request fails, `extractCrlUrl` (`src/utils.js`) takes the first `http(s)` URL out of the QE-identity issuer chain header and `httpGet` fetches it. The quote does not choose the PCCS host. A redirect from one of these hosts would be followed.

Recommendation: set `redirect: "error"` on Glassbox's own fetches once you know the public hosts do not need a redirect. Upstream, ignore CRL URLs that are not on an allowlist of Intel and Phala hosts.

**7. Secret-name detection misses some real names, and it does not look at `pre_launch_script`.**

Evidence: `packages/core/src/evidence/compose.ts` `isSecretEnvName` matches `PRIVATE_KEY`, `API_KEY`, `SEED`, `MNEMONIC`, `SECRET`, `PASSWORD`, and `TOKEN`. `AWS_ACCESS_KEY_ID` does not match. Shell `export` lines in `pre_launch_script` are not env names. The votron fixture's AWS lines are `$DSTACK_*` references, so this is a detection gap, not a leaked value. Reports still do not print env values (`packages/core/src/report.ts` `secretFinding`).

Recommendation: add `ACCESS_KEY` (with the existing `API_CODEHASH` exception) and scan `pre_launch_script` for assignments whose values are not `$` references.

**8. The web response has no extra security headers.**

Evidence at the time of this pass: `apps/web/next.config.ts` set transpile and webpack only. There was no `Content-Security-Policy`, `X-Content-Type-Options`, or frame policy. Rendering goes through React text nodes (`apps/web/components/Ladder.tsx:67`), which is the control that matters for the report. A later change adds those headers. `script-src` and `style-src` allow `'unsafe-inline'` because the theme bootstrap and the Next.js runtime inject inline content. HSTS stays with Vercel.

**9. Dependency advisories (lockfile, earlier pass on 2026-11-05).** Superseded by the re-run section. Do not quote this subsection as that re-run. The command that produced these sentences reported 1 critical, 5 high, 5 moderate, 1 low. Nothing below was reproduced as a reachable bug in Glassbox. No advisory was "fixed" by editing the lockfile; the paths are nested where an override can break Next or the sandbox.

| Advisory severity | Package (installed) | Advisory | Where it sits | Exposure here |
| --- | --- | --- | --- | --- |
| Critical | `tar` 7.5.13 | [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) / CVE-2026-59873, decompression DoS. Also high: GHSA-8x88-c5mf-7j5w / CVE-2026-59874, GHSA-r292-9mhp-454m / CVE-2026-73566. Moderate: GHSA-vmf3-w455-68vh / CVE-2026-53655, GHSA-w8wr-v893-vjvp / CVE-2026-59871, GHSA-gvwx-54wh-qm9j / CVE-2026-59875. Patched in `tar` >= 7.5.21 for the newest of these. | `near-sandbox` 0.3.4, **devDependency** of `packages/core` | The auditor does not parse tar. The local sandbox test does, when it unpacks its runtime. A hostile tar has to be the archive `near-sandbox` extracts. |
| High | `postcss` 8.4.31 | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) / CVE-2026-45623 and [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) / CVE-2026-73646 (`.map` file read via `sourceMappingURL`). Moderate: GHSA-qx2v-qp2m-jg93 / CVE-2026-41305, GHSA-fxqj-rqcc-2cmp / CVE-2026-69153. Patched line in the newest note is `postcss` >= 8.5.23. | `next` 15.5.29 → `apps/web` | Next compiles this repo's CSS. The audit form does not submit CSS. Not reachable from `/api/audit`. Bump Next when a release depends on a patched PostCSS; do not force an override without a build check. |
| High (audit range) | `zod` 3.25.76 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) / CVE-2023-54404. `pnpm audit` applies it because the published range is `< 4.6.6`. The advisory text describes `$ZodArray` in Zod through 4.6.5: an unconstrained array schema retains every issue and can exhaust memory. First patched version named by the advisory: 4.6.6. | `glassbox-mcp` and `@modelcontextprotocol/sdk` 1.32.2 | `check_agent` validates a string and an enum, not an unconstrained array. Zod 4 is a different major from the SDK's zod 3 dependency. Do not bump majors on the strength of the range string alone. |
| Low | `elliptic` 6.6.1 | [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84) / CVE-2025-14505. ECDSA *generation* can truncate RFC 6979 `k` when it has leading zeros, which can leak the signing key if a faulty signature is compared with a good one. The advisory lists no patched version (`<= 6.6.1`). | `@phala/dcap-qvl` 0.7.1 (quote **verification**) and `near-api-js` → `secp256k1` (devDependency, sandbox test) | The audit path does not sign. Quote verification uses elliptic to check signatures, which is not the generation bug described. The sandbox test signs with `near-sandbox`'s well-known local key. |

### Info

**10. Repository visibility.** This pass did not change it. Hackathon notes say a public repo is required to submit. Glassbox is public at https://github.com/Adelekejr/Glassbox. This record does not deploy, publish to npm, or submit.

**11. Licences do not look like a submit blocker.** The project is MIT (`LICENSE`). `NOTICE` keeps the Apache-2.0 notices for `@phala/dcap-qvl`, the Shade measurement tables, and `shade-contract-template.wasm`. `pnpm licenses list` groups are MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, BlueOak-1.0.0, CC-BY-4.0 (`caniuse-lite`), and one LGPL-3.0-or-later package: `@img/sharp-libvips-linux-x64` (transitive through Next). No GPL or AGPL package was listed. The app does not use `next/image`. LGPL here is a replaceable native library, not a reason to relicense Glassbox. If you ship `node_modules`, keep that LGPL notice with the binary.

**12. Shade interface and several **PROVEN** rows trust the contract's own views.** `classifyShade` (`packages/core/src/audit.ts`) keys off method names. `agent.validity` is **PROVEN** when the view says `Valid`. `measurements.approved` is **PROVEN** when `get_agents` matches `get_approved_measurements` on the same contract. A contract can implement those methods and agree with itself. The wording matches the ladder rule (a view returned the value named in the sentence). It is not an Intel attestation. `runtime.observed` stays **NOT PROVEN**.

**13. A debug quote that still verifies is reported separately, and the report stays **RISKY**.** `verifyQuoteAt` calls `allowDebug(true)` only so TCB status can be read; `tdx.debug` is **RISKY** when the bit is set. `overall` is **RISKY** if any finding is. That split is intentional (`HANDOFF.md`).

## Confirmed solid

- **No committed secrets found** by the pattern scan above, including history. `.env` and `.env.*` are gitignored. The fixture rebuild script refuses to write if a removed secret-looking value is still in the output (`packages/core/scripts/build-fixture.ts`). The report prints env names, not values.
- **No `eval`, `new Function`, or shell string execution.** CLI and MCP launchers use `spawn(process.execPath, [tsx, script, …args])` (`packages/cli/bin/glassbox.js:10`, same pattern in `packages/mcp/bin/glassbox-mcp.js`). Arguments are an array.
- **Web XSS:** report text is React children, not `dangerouslySetInnerHTML`. Evidence links are `https://` URLs we build (`accountUrl`, `txUrl`, `advisoryUrl`, and the fixed Phala / Intel / GitHub links). The path segment is now encoded.
- **CORS:** the audit route does not set `Access-Control-Allow-Origin`. A browser on another origin cannot read the response. The client sends `application/json`, which is not a simple request.
- **SSRF via the account id:** history URLs are fixed hosts plus `encodeURIComponent(accountId)` (`packages/core/src/near/history.ts:116` and `:181`). RPC hosts are the FastNEAR / `near.org` list (`packages/core/src/near/rpc.ts`). The web route no longer passes arbitrary strings into those URLs; the account id has to match the NEAR grammar. The caller cannot set `rpcEndpoints`.
- **Quote trust anchor:** Glassbox uses `new QuoteVerifier()` with no custom root. Verification failure is no longer reported as **PROVEN** measurements, debug, or report-data binding.
- **RTMR replay** of a bad digest is caught and becomes **NOT PROVEN** (`packages/core/src/report.ts` `replayFinding`), not a process crash.
- **NearBlocks:** method names come from a fixed list (`approvalMethodsFor`), calls are spaced (default 10.5 s), two pages max, and the report attributes NearBlocks only when that API was used.
- **Supply chain:** `packageManager` is `pnpm@10.33.4`. Install scripts were limited to `esbuild`, `near-sandbox`, `near-workspaces`, and `secp256k1`. A frozen install ran the esbuild postinstall and the secp256k1 install and no others. The lockfile is version 9.0. Package resolutions checked here carry `integrity` hashes. No `git+`, `http://`, or non-registry tarball URL showed up in the lockfile. The re-run section records the move of that allowlist to `allowBuilds` in `pnpm-workspace.yaml`. The four names are unchanged.
- **Read-only chain client:** `NearClient` posts JSON-RPC `query`, `tx`, and `block`. It does not sign and does not send a transaction (`packages/core/src/near/rpc.ts`).
- **Wording tests still pass.** Fixture and CLI reports still fail the suite if they contain "hacked" or "currently running".

## Dependency audit re-run (2026-11-05T22:25:43Z)

Commands, on this checkout, pnpm 10.33.4, Node v22.23.4:

- `pnpm audit` — 290 dependencies in the report metadata. **1 critical, 5 high, 5 moderate, 1 low.**
- `pnpm audit --prod` — 204 dependencies in the report metadata. **0 critical, 3 high, 2 moderate, 1 low.**

The full-audit severity totals match the earlier same-day note in section 9. They are listed again because these commands were run at `2026-11-05T22:25:43Z`. Section 9 is not this re-run. Nothing below was turned into a proof-of-concept. No dependency version was changed.

`pnpm install --frozen-lockfile` with the allowlist in `pnpm-workspace.yaml` completed without a warning that a `package.json` `pnpm` field was ignored. The esbuild postinstall and the secp256k1 install ran. `dangerouslyAllowAllBuilds` is not set. The pin stays `pnpm@10.33.4`.

| Audit | Severity | Installed | Advisory | Path pnpm printed | Why it was left |
| --- | --- | --- | --- | --- | --- |
| full | Critical | `tar` 7.5.13 | [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw). Also high [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w), [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m). Moderate [GHSA-vmf3-w455-68vh](https://github.com/advisories/GHSA-vmf3-w455-68vh), [GHSA-w8wr-v893-vjvp](https://github.com/advisories/GHSA-w8wr-v893-vjvp), [GHSA-gvwx-54wh-qm9j](https://github.com/advisories/GHSA-gvwx-54wh-qm9j). Newest patched line in this report: `tar` >= 7.5.21. Registry latest seen while checking: 7.5.22. | `packages/core > near-sandbox > tar` | `near-sandbox` 0.3.4 is a devDependency and depends on `tar` 7.5.13. `near-sandbox` 0.3.5 still depends on `tar` 7.5.13. This path is absent from `pnpm audit --prod`. No override was added. |
| full and prod | High | `postcss` 8.4.31 | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849). Moderate [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp). Newest patched line in this report: `postcss` >= 8.5.23. | `apps/web > next > postcss` | `next` 15.5.29 is the latest Next 15 and depends on `postcss` 8.4.31. `next` 16.4.5 depends on `postcss` 8.5.23. Next 16 was not taken. No PostCSS override was added. |
| full and prod | High | `zod` 3.25.76 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Patched line in this report: `zod` >= 4.6.6. | `packages/mcp > zod` | 3.25.76 is the latest 3.x. `@modelcontextprotocol/sdk` 1.32.2 (current latest) declares `zod` `^3.25 \|\| ^4.0`. The audit output listed this one path. Zod 4 was not taken. `check_agent` validates a string and an enum. |
| full | Low | `elliptic` 6.6.1 | [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84). This report's patched range is `<0.0.0` (no patched release). | `packages/core > near-api-js > @near-js/crypto > secp256k1 > elliptic` | Dev path, through the sandbox test's `near-api-js`. No patched version to install. |
| prod | Low | `elliptic` 6.6.1 | Same advisory. | `packages/core > @phala/dcap-qvl > elliptic` | Production path is quote verification. The advisory describes ECDSA generation. No patched version to install. |

The same change sets response headers in `apps/web/next.config.ts`: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and a same-origin Content-Security-Policy. `script-src` and `style-src` include `'unsafe-inline'`. A production `next start` was loaded in headless Chrome. The saved-sample control ran, a rejected audit left that report in place, and the console reported no Content-Security-Policy refusal. HSTS is not set here.

## Not done

- No live audit of a NEAR account was run for this review (those calls spend NearBlocks quota).
- Dependency advisories were not patched and were not turned into proof-of-concept inputs.
- The page was not clicked through in a browser. The route and the form HTML were checked over HTTP, and the account/JSON classifier is unit-tested.
