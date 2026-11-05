# Glassbox security delta (adds 1–6)

Date: 2026-11-05. Scope: the squash of PR #6, commit `18b276d4d584b7a2b63fa32e914d415cbc7d1fc9` ("Add threat model, provenance, contract checks, diff, and an anchor stub"), reviewed against `b23ad39` (PR #5). Surfaces: threat-model paragraph, measurement provenance, contract checks, `glassbox diff`, freshness (including the optional Phala probe), and the `--anchor` / `GLASSBOX_ANCHOR=1` stub, plus a re-check of the PR #3 fixes in [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

The site was not restyled. The repository was left private. Nothing was published, deployed, or signed on NEAR. No NEAR private key was loaded. No transaction was sent. Anchor remains a no-op.

## How this was checked

- Read the new and changed modules (`checks/liveness.ts`, `checks/provenance.ts`, `checks/dstack.ts`, `checks/contract.ts`, `diff.ts`, `signed/anchor.ts`, `report.ts`, `audit.ts`, the CLI `diff` / `--anchor` paths, `Ladder.tsx`, and the web audit route).
- Ran the allowlist in `liveEndpointAllowed` against Node's URL parser (Node 22.23.4): `file:`, `http:`, `javascript:`, userinfo, IPv4 (dotted, short, octal, hex, decimal), IPv6 and IPv4-mapped IPv6, null bytes, CR/LF host injection, `%2e` / trailing-dot suffix tricks, apex names, and names that only share a suffix (`notphala.network`, `evilphala.com`).
- Stood up a local HTTP server and called `fetch` with `redirect: "error"`. The client threw `TypeError: fetch failed` with cause `unexpected redirect` after the first response. The `Location` target was not requested. The default `redirect: "follow"` on the same server did request the second URL.
- `pnpm test` after the fixes below: core 41, CLI 6, MCP 4, web lib 2, and `pnpm run typecheck`. All passed.
- Searched every blob in `git rev-list --all` for private-key blocks, `AKIA…`, `ghp_`, `github_pat_`, Slack tokens, `sk-` / `sk-ant-` tokens, npm tokens, and JWTs. The only hits are this kind of pattern list inside `SECURITY-AUDIT.md`, and the test canary `sk-ant-not-a-real-secret-value` in `packages/core/test/engine.test.ts`. `packages/core/test/fixtures/diff-left.json` and `diff-right.json` are hashes and a compose with no secret values.
- `package.json` files and `pnpm-lock.yaml` are unchanged from `b23ad39` to `18b276d`. `pnpm audit` was not re-run. No new CVE is claimed here. The advisory table in `SECURITY-AUDIT.md` still describes that lockfile.

## Fixed in this pull request

| Severity | Issue | Evidence | What changed |
| --- | --- | --- | --- |
| Medium | A registration could be **PROVEN** "a known fixed image" when `tcb_info.os_image_hash` was a published fixed hash and the `os-image-hash` event payload was a different string. `dstack.upgrade` then said the 20 Nov 2026 schedule does not apply to that fixed image. The event is the value an RTMR replay can bind. The field was preferred whenever it was present (`tcb.os_image_hash ?? event`). | Was `packages/core/src/report.ts` (the old `??` selection). Now `packages/core/src/evidence/registration.ts` `selectOsImageHash`, `packages/core/src/checks/dstack.ts:63`, `packages/core/src/checks/provenance.ts:26`. | When both values exist and are not the same hash, neither is treated as a known fixed image. The provenance row is **NOT PROVEN** ("disagree"). `dstack.range` is **NOT PROVEN** unless a clean Shade table hit still applies, in which case the row is the vulnerable-table wording and says the hash was not treated as a known fixed image. Equal values, including a leading `0x`, still compare as one hash. |
| Medium | RTMR1 and RTMR2 could hit a Shade 0.5.7/0.5.8 row while a present MRTD did not match that row. `versionHit` was set before the MRTD check, so the mismatch still returned a table hit. Provenance then said the MRTD "matches" whenever the field was non-empty. A published fixed `os_image_hash` beside that hit could stay **PROVEN** "known fixed image" on `dstack.range`, because that check did not see the agent-row measurements provenance used. | `packages/core/src/data/shade-measurements.ts:197` (`mrtdMatched`). `packages/core/src/checks/provenance.ts:56` and `:116`. `packages/core/src/report.ts:642` and `registeredMeasurements` (same measurement source for provenance and dstack). | A present, differing MRTD is `mrtdMatched: false`. That is not a clean table hit, and it is not labeled a known fixed image. The evidence line says the MRTD does not match. A missing MRTD still does not block an RTMR1/RTMR2 match. Approved-row matching requires `mrtdMatched === true`. |
| Medium | `viewFunction` treated any error string containing `MethodNotFound` as "method absent". A guest panic whose `panic_msg` is `MethodNotFound` took that path. `contract.remove` then said **PROVEN** "is not on this account" from `methodExists === false`. | `packages/core/src/near/rpc.ts:147` and `isHostMethodNotFound` at `:202`. The **PROVEN** absence text is `packages/core/src/checks/contract.ts:305`. | Host `MethodResolveError(MethodNotFound)` is still "method absent". A `GuestPanic` / `panic_msg` is an execution error, so the method counts as present. |
| Low | A capture or RPC key whose `FunctionCall` permission was `null`, or whose `method_names` was not an array of strings, threw in `describeKeys` (`call.receiver_id`) and in `assessAccessKeys`. The audit aborted instead of finishing a report. | `packages/core/src/checks/contract.ts:135` and `describeKeys`. `packages/core/src/checks/access-keys.ts` (the `FunctionCall` branch). | Unreadable keys do not throw. The approver row stays **NOT PROVEN** when that key could have been the difference between one key and a broader set. The access-key row says the key could not be read. |
| Low | With the owner view equal to this account and exactly one full-access key, `contract.approver` was **PROVEN** "one full-access key can call …" even when indexed history showed a successful approve signed by a different account. The signer was only in the evidence list. | `packages/core/src/checks/contract.ts:154`. | That case is **NOT PROVEN**, and the sentence names the other signer. Two or more signers stay **RISKY**, as before. A broader key set on the account stays **RISKY** and is decided before this check. |

## Open findings

### Low

**1. A pasted JSON `code_hash` or `os_image_hash` can still be PROVEN without a chain read.**

Evidence: `packages/core/src/audit.ts:623` (`withAttachedCodes`) copies `code_hash` / `codeHash` from any JSON object onto the bundle. `packages/core/src/checks/contract.ts:251` returns **PROVEN** "Contract code hash matches a known Shade template" on an exact match with the vendored wasm hash. A file whose `os_image_hash` is on the fixed list is **PROVEN** "known fixed image" when it does not also hit a Shade table (`packages/core/test/fixtures/diff-left.json`, and the product test that expects that ladder). The shade detail says the file was not read from chain. The finding title does not.

This is the same trust as the earlier capture-file finding (SECURITY-AUDIT.md, open item 2), now on the new contract and provenance rows, and it no longer requires `kind: "glassbox-capture"`. On a live account, `code_hash` comes from `view_account`, which the contract cannot invent. The gap is file and pasted-JSON mode, including `/api/audit` when the body is JSON text.

Recommendation: when `historySource === "file"`, start those sentences with "The file says", or use **NOT PROVEN** for contract-code and fixed-image rows. Leave a live `view_account` code hash and a quote-backed measurement comparison as they are. This pass did not change that ladder, because the product tests treat the file comparison as the check.

**2. `glassbox diff` reads any local path the operator names.**

Evidence: `packages/cli/src/run.ts:366` (`loadTarget`) uses `existsSync` and then `auditFile` / `readFileSync`. There is no root jail. Symlinks are followed. A non-JSON file is scanned as compose text (`bundleFromLooseText` in `packages/core/src/audit.ts`). The CLI test still checks that a secret value in the loose compose fixture is not printed.

This matches the CLI file mode already noted in SECURITY-AUDIT.md (open item 5). `diff` is a new entry point with two paths. It does not go through a shell: arguments stay in an array (`packages/cli/bin/glassbox.js`). Unknown flags are rejected. `diff` rejects `--anchor` and `--sign` (`packages/cli/src/run.ts` `runDiff`). The web route and MCP `check_agent` do not implement `diff`.

Recommendation: leave the CLI unrestricted, and do not add `diff` to the web route or to MCP without the same account-or-JSON rule the audit route already uses.

**3. `contract.approver` PROVEN is the key set on this account, not a proof that other accounts are rejected.**

Evidence: `packages/core/src/checks/contract.ts` returns **PROVEN** "One full-access key can call …" when the owner view equals this account and one full-access key is present. The sentence says no other key on the account can call the method. It does not require `contract.code` to match the vendored Shade template, and a template match is the only place this build compares wasm. A contract that does not check `owner` can still take that **PROVEN** row if its view returns this account as owner.

Recommendation: keep the key-set sentence, and do not widen it to "only this key can succeed" unless the code hash matches a template whose source checks the caller. A miss on the template stays **NOT PROVEN**, which is already what `assessContractCode` does.

### Info

**4. The Phala guest probe is limited to a public suffix, and it is not wired to a registration field.**

`liveEndpointAllowed` (`packages/core/src/checks/liveness.ts:11`) allows `https` only, rejects userinfo, rejects `localhost` and `*.localhost`, rejects dotted IPv4 and any host containing `:`, and requires the host to end with `.phala.network` or `.phala.com` and to be longer than that suffix. `probeLiveGuest` sets `redirect: "error"` (`packages/core/src/checks/liveness.ts:54`). The checks above did not find a URL whose parsed host left those suffixes and was still allowed. In particular: `file:`, bare IPs, `https://phala.network` (no leading label), `https://notphala.network`, `https://evilphala.com`, and `https://a.phala.network.evil.com` are refused. A newline inside `https://evil.com\n.phala.network` is normalized by the URL parser to host `evil.com.phala.network`, which is still under that suffix. A CR/LF host-header split throws `Invalid URL`. A null byte throws `Invalid URL`.

What remains: any path and any port on any hostname under those two suffixes is eligible (`https://pccs.phala.network:8443/…` is allowed). That can only run when a library caller sets `AuditOptions.liveEndpoint`. `collectAccount` is the only caller (`packages/core/src/audit.ts:258`). `auditValue` / pasted JSON ignore a `liveEndpoint` field and do not call `fetch` for it. The web route (`apps/web/app/api/audit/route.ts`) and MCP `checkAgent` do not pass `liveEndpoint`. The CLI has no flag for it. A successful answer does not move `freshness.registration` off **NOT PROVEN** (`packages/core/src/report.ts:1487`).

Recommendation: if a later build copies a registration URL into `liveEndpoint`, keep this allowlist and `redirect: "error"`, and re-check the response URL against the same function before putting the host in the report. Prefer a single guest hostname pattern over the whole suffix if Phala publishes one.

**5. Anchor env can record intent on every report in the process. It does not spend.**

Evidence: `packages/core/src/signed/anchor.ts:26`. Every return path sets `status: "skipped"`. The module imports types only. It does not import `near-api-js`, does not call `KeyPair`, and does not build a transaction. `--anchor` passes `anchorIntent: true` (`packages/cli/src/run.ts:133`) and prints `ANCHOR_INSTRUCTIONS`, which say this build does not build a transaction, does not load a NEAR signer, and does not spend gas.

`GLASSBOX_ANCHOR` enables intent only when the value is exactly `1`. `true`, `yes`, and an empty value do not. The web and MCP paths do not pass `anchorIntent`, but `planReportAnchor` still reads the environment variable, so a server started with `GLASSBOX_ANCHOR=1` marks every report `intent: true` and still sends nothing.

`GLASSBOX_SIGNING_KEY` (`packages/core/src/signed/keys.ts:17`) is an ed25519 report-signing PEM loaded only for `--sign` / `--out`. It is not a NEAR account key. No code path reads `NEAR_PRIVATE_KEY`, `NEAR_SIGNER_KEY`, or similar. The sandbox test's `KeyPair` is the local `near-sandbox` account and is not on the `--anchor` path.

Recommendation: when a later build grows a sender, put it in a new function that the web and MCP entry points cannot reach. Do not treat `GLASSBOX_ANCHOR=1` or the report-signing PEM as a NEAR signer. Do not load that signer inside `planReportAnchor`.

**6. Earlier open items were not regressed, and they were not closed.** MCP may still read any `.json` path (`packages/mcp/src/check.ts`). `/api/audit` is still an unauthenticated proxy if it is exposed (`apps/web/app/api/audit/route.ts`). The CLI still prefers an existing path over an account id (`packages/cli/src/run.ts`). Glassbox's own RPC and NearBlocks `fetch` calls still use default redirect following (`packages/core/src/near/rpc.ts` `call`, and `packages/core/src/near/history.ts`). Secret-name detection is unchanged. The web response still has no CSP. Dependency advisories are unchanged because the lockfile is unchanged.

## Confirmed solid

- **Phala probe cannot be aimed at an arbitrary host from the new user-facing paths.** See open item 4 for the allowlist result. Registration JSON, the web form, MCP, and the CLI do not pass a guest URL into `probeLiveGuest`.
- **Redirects on that probe are not followed.** `redirect: "error"` throws `unexpected redirect` before the next hop. Collateral fetches still force `redirect: "error"` inside the allowlist guard (`packages/core/src/checks/pccs.ts:111`).
- **Freshness does not become PROVEN.** `freshness.registration` is hard-coded **NOT PROVEN** (`packages/core/src/report.ts:1488`). `provenAtRegistrationOnly` stays true. A reachable guest is described as not the registered configuration. `valid_until_ms` goes through `isoFromUnixMs`, which rejects non-finite and out-of-range times instead of throwing.
- **Hash versus Shade-table disagreement is not "a known fixed image".** A clean RTMR1/RTMR2 hit together with a fixed `os_image_hash` stays the disagree path (`packages/core/src/checks/dstack.ts:91`, `packages/core/src/checks/provenance.ts:125`): **RISKY**, and the detail says the registered configuration is not treated as a known fixed image. A declared `dstack_version` of 0.5.12 or 0.6.1 with no hash stays **NOT PROVEN** (`packages/core/src/report.ts` `declared-fixed`). That closes the earlier "declared string is PROVEN fixed" item for this tree.
- **A known fixed image is an exact hash compare.** `lookupFixedImage` lowercases, strips one leading `0x`, and requires the full published digest (`packages/core/src/data/fixed-images.ts`). A prefix does not match.
- **Contract code PROVEN is exact.** `matchShadeTemplate` compares the trimmed base58 code hash or the full sha256 hex (`packages/core/src/data/shade-templates.ts`). The empty account hash is **NOT PROVEN**, not a template match. The vendored wasm test still checks `codeHashOfWasm` against the recorded hash.
- **Approve/remove probes do not send a transaction.** They use `viewFunction` (`call_function`) in `packages/core/src/audit.ts:190`. An RPC failure leaves the method unprobed rather than recording MethodNotFound.
- **Anchor does not spend.** See open item 5. `diff` refuses `--anchor`. Status is `skipped` with and without the flag (`packages/core/test/signed-report.test.ts`, `packages/core/test/product-adds.test.ts`).
- **Web XSS on the new paragraph.** `threatModel` is the constant `THREAT_MODEL_DISCLOSURE` (`packages/core/src/types.ts`). `Ladder` renders it as a React text child (`apps/web/components/Ladder.tsx:66`), along with finding titles, plain English, approval signers, and limitations. There is no `dangerouslySetInnerHTML`. Evidence `href`s are still built with a fixed `https` host and `encodeURIComponent` (`accountUrl`, `txUrl`, `advisoryUrl`). The proof-strip HTML escapes text (`packages/core/src/agent-index.ts` `escapeHtml`).
- **POST /api/audit still does not read local files.** The route classifies with `classifyWebTarget` and then calls `auditAccount` or `auditValue` (`apps/web/app/api/audit/route.ts`). It does not call `auditTarget` or `auditFile`. `apps/web/lib/network.test.ts` still rejects `/etc/passwd`, `../.env`, and similar paths. `package.json` as an account id is classified as an account, not opened as a file.
- **Quote failure is still not PROVEN.** Parsed quote fields are ignored unless verification succeeds (`packages/core/src/report.ts:253`). The bad-collateral test still expects **NOT PROVEN** for signature, debug, report data, and measurement match.
- **CLI and MCP do not shell out.** Both launchers use `spawn(process.execPath, [tsx, script, …args])`. `diff` paths are file reads or account ids, not a command string. MCP still refuses a URL and a caller-supplied PCCS or RPC host, and it does not forward `liveEndpoint` or `anchorIntent`.
- **Crafted registration JSON that this pass tried does not flip a known-fixed PROVEN row or crash the new key parser.** A conflicting hash pair is **NOT PROVEN** / not "is a known fixed image". A `FunctionCall: null` key returns **NOT PROVEN** instead of throwing. `normalizeV2Agent` still drops a non-numeric `valid_until_ms`. Reports from these inputs do not contain "hacked".
- **No new secrets in the added fixtures or in git history.** See the search above. `.gitignore` from the earlier pass still ignores key filenames.

## Not done

- No live NEAR account was audited, and no Phala host was contacted. The allowlist and redirect checks used Node's URL parser and a local HTTP server.
- The web form was not clicked. The route, the classifier test, and the React render path were re-read. This pass does not change the page.
- Dependency advisories were not patched and were not turned into proof-of-concept inputs.
- The repository visibility was not changed.

## Later note (2026-11-05, honesty pass)

Open item 1 (a pasted JSON `code_hash` or `os_image_hash` can be PROVEN without a chain read) was not closed by changing the ladder. The comparison stays PROVEN. When `historySource` is `file`, those sentences now say the file supplied the value and that this run did not call `view_account`, `get_agent`, or `view_access_key_list`. A verified quote still checks the bytes in the file, and the signature sentence says this run did not fetch them from chain. A report limitation states that a file PROVEN row is not a fresh chain read.

`pnpm audit` was run again on this checkout (pnpm 10.33.4, Node 22.23.4) against the same lockfile. The vulnerability counts are still 1 critical, 5 high, 5 moderate, 1 low. The advisory table in [SECURITY-AUDIT.md](SECURITY-AUDIT.md) was not rewritten. No dependency was bumped.

The repository was still private. Nothing was published or deployed. `--anchor` is still `skipped`. The local web page gained one sentence on `ironshield.near`. It was not restyled.
