# Handoff — Glassbox day 2

Written 2026-11-04 so another session can continue without re-deriving the rules.

## Done

- pnpm workspace. `packages/core` is the library. `packages/cli` is `glassbox <account|file>` (`pnpm --filter cli start …`, human text, or `--json`).
- `packages/mcp` (`glassbox-mcp`) is a stdio MCP server. Tool `check_agent` returns `{ overall, summary, report }`. See `packages/mcp/README.md` for Claude Desktop and Cursor config. Not published to npm yet; local install uses `node --import tsx`.
- `apps/web` is a plain Next.js form. `pnpm --filter web dev`. POST `/api/audit` accepts a NEAR account id or JSON text and does not read local files (`auditTarget` does, so the route must not call it). Do not deploy. Restyle `components/Ladder.tsx` and `components/AuditForm.tsx` later. Next needs `extensionAlias` in `next.config.ts` so core's `.js` imports resolve to `.ts`.
- Shade v2: `get_approved_measurements` rows may be nested `{ rtmrs, key_provider_event_digest, app_compose_hash_payload }`. `get_agents` fills `v2Agents`. A match is PROVEN. All-zero rows are the local-mode default and are RISKY (`measurements.local_default`), not a TDX measurement. `requires_tee: false` is stated in the interface sentence.
- Local sandbox test: `packages/core/test/shade-v2.sandbox.test.ts` plus `fixtures/shade-contract-template.wasm` (Apache-2.0, framework commit 35758f3). Uses `near-sandbox` 0.3.x (neard 2.13) and `near-api-js`. The test passes `finality: "optimistic"` because a one-node sandbox has not finalized the latest block. Public audits stay on `final`. No testnet transaction.
- Approval history is an on-demand section, cached in memory for 10 minutes (`GLASSBOX_HISTORY_CACHE_MS`). v1 reads `approve_codehash` and `remove_codehash`. v2 reads `approve_measurements`, `remove_measurements`, `approve_ppids`, `remove_ppids`. Not a watcher. NearBlocks attribution still required.
- `overall` on the report is the highest rung already listed. Do not invent a second score.
- Read-only NEAR JSON-RPC. FastNEAR public RPC, then `near.org`. Archival RPC for the registration transaction. About 300 ms between ordinary RPC calls, about 1 s on the archival client. No signing, no transactions.
- Network from the account suffix: `.testnet`, `.near`. Anything else (today: `v1.signer`) is tried on mainnet, then testnet.
- Shade interface detection by view methods, not by guessing a code hash:
  - `get_contract_info`, or `get_approved_measurements` together with `get_agents` → shade-v2
  - `get_agent` → shade-v1
  - `get_worker` → shade-v1-worker
  - `get_approved_measurements` alone → measurements-registry (this is `worker.outlayer.testnet`)
  - `allowed_docker_image_hashes` → mpc-signer
- Registration arguments come from `register_agent` / `register_worker` history, then the archival `tx` body. v1 codehash approval comes from `approve_codehash` history plus `get_agent`.
- Checks that are live for votron: TDX verify at the registration timestamp and again against fresh Phala PCCS collateral (`@phala/dcap-qvl` 0.7.1), debug bit, report-data binding, quote vs `tcb_info`, RTMR replay, compose-hash, image digest pins, dstack range, `public_logs`, secret-looking env names, the 20 Nov 2026 schedule, access keys, and the two MPC allowlists.
- `pnpm test` passes (fixture unit tests, RPC client tests, CLI test, `tsc`). `pnpm --filter cli start ac-sandbox.votron.testnet` prints a real report. On 2026-11-04 that report was 6 risky, 3 not proven, 9 proven, including UpToDate at registration and OutOfDate on fresh collateral with INTEL-SA-01192 / 01245 / 01312 / 01313 / 01367.
- `pnpm smoke` completed on the eight public targets: votron, ajitesh-1, and nova-shade-agent are shade-v1; both leo-leo-leo accounts are shade-v1-worker (the proxy had no successful registration in the index); `worker.outlayer.testnet` is a measurements registry; both signer accounts are mpc-signers. `v1.signer` did not flag a full-access key.

## Wording rules (do not relax these)

- Say "matches a vulnerable configuration" or "not a known fixed image". Never "hacked", "compromised", or "pwned".
- Say "registered configuration". Do not say the guest is "currently running" that image. A registration is not a live observation. Finding `runtime.observed` exists to keep that gap visible.
- Mark inferences. The pre-0.5 tappd.sock pattern is an inference. A Shade 0.5.7/0.5.8 table hit is a comparison with the published table, not a measurement Glassbox computed. An unknown `os_image_hash` is "not a known fixed image", and the fixed list can lag a newer release.
- Do not print env values. Names only.
- Do not score payments. If a method is `pay_by_agent` or similar, leave it alone. Gideon owns that question.
- NOT PROVEN is not a clean bill of health. Do not turn a missing view into "safe".
- When NearBlocks is called, the report must contain the line `Powered by Nearblocks.io APIs.`

A test in `packages/core/test/engine.test.ts` fails if a votron report contains "hacked" or "currently running".

## Accuracy notes the next edit must keep

- RTMR replay is SHA-384(current || 48-byte event digest), start at 48 zero bytes, events in log order, filtered by `imr`. Checked: votron imr 0..3 reproduce rtmr0..3.
- Compose hash is SHA-256 of the **exact** `app_compose` string stored in the registration, compared to the `compose-hash` event payload (or `compose_hash` on a v2 attestation). Re-stringifying JSON will not match. The votron payload is `cdfac6870932559754412f5571b45818c26f93da9cf6247d919679d6960bbb78`.
- Stored-collateral verify must use the registration timestamp. Verifying old collateral "now" fails because the collateral expired, which is a different fact from TCB OutOfDate. Fresh collateral is a second call, at the current time.
- Debug is TDX `TUD.DEBUG`, bit 0 of the first little-endian attributes byte. `@phala/dcap-qvl` rejects debug quotes unless `allowDebug(true)`. Glassbox still reports the bit, and still asks for a TCB status with debug allowed so the two facts stay separate.
- Shade v1 cannot list approved measurements. A matching `approve_codehash` proves the app image digest was approved in the indexed history. It does not prove a TDX measurement was approved. If the indexer does not show the hash, the finding stays NOT PROVEN, because the index can be incomplete.
- Fixed `os_image_hash` values are only the five published 0.5.12 / 0.6.1 variants in `packages/core/src/data/fixed-images.ts`. Do not add older published hashes to that list; those images are inside the vulnerable range. Shade tables in `packages/core/src/data/shade-measurements.ts` are copied from shade-agent-cli (Apache-2.0) and only contain 0.5.7 and 0.5.8. `worker.outlayer.testnet` RTMR1 `a7b52327…` matches neither.
- `v1.signer` is a mainnet account (parent `signer`, not `signer.near`). `v1.signer.testnet` does not exist. The prod testnet account is `v1.signer-prod.testnet`. One allowlist entry expires 2026-11-05 (testnet) and 2026-11-06 (mainnet). Compare digests; do not treat a miss as a Shade failure.
- The 20 Nov 2026 text is date-aware via `AUTO_UPGRADE_AT` in `packages/core/src/types.ts`. After that instant the sentence must say the date has passed.
- No test target here is Shade v2. Do not fake a v2 fixture. A v2 path should use `get_approved_measurements` (mrtd, rtmr0–2, key provider digest, app compose hash payload). OutLayer's view also returns rtmr3 and is classified separately on purpose.

## Secrets

The votron compose on chain does **not** inline seed phrases or API keys. `NEAR_SEED_PHRASE` and `ANTHROPIC_API_KEY` are `${NAME}` references. The compose salt was still replaced with `REDACTED` before `packages/core/test/fixtures/votron-registration.json` was written. `originalAppComposeSha256` is the chain hash and must keep matching the compose-hash event. The redacted string must **not** hash to that value (the test checks this).

`packages/core/scripts/build-fixture.ts` rebuilds that file from a raw args JSON path. It throws if a removed value is still in the output. Do not commit the raw args. Do not commit `.env` files. The report builder must not gain a field that echoes `app_compose`.

## How to continue

```bash
pnpm install
pnpm test
pnpm --filter cli start ac-sandbox.votron.testnet
pnpm smoke
```

`pnpm test` is the offline bar. `pnpm smoke` hits the network and is allowed to be slow. NearBlocks spacing is `GLASSBOX_NEARBLOCKS_INTERVAL_MS` (default 10500). Set it only for a local debug session, not to hammer the free tier.

FastNEAR tx history (`https://tx.test.fastnear.com/v0/account/<id>` and the mainnet twin) was 404 on 2026-11-04. `packages/core/src/near/history.ts` still tries it and falls through. If it starts returning JSON, teach `parseFastnear` with a real payload rather than removing NearBlocks. Keep the attribution whenever NearBlocks is actually called.

Work on `cursor/…` branches off `main`. Keep commits small. Do not open a hosted deploy, an MCP server, or a web UI inside a drive-by edit; those packages are empty on purpose.

## Next, in order

1. A real Shade v2 TEE registration (not local-mode zeros) if the owner accepts a deploy. The sandbox path only proves the interface and the approved-list compare. `requires_tee: true` still needs a quote Glassbox can verify; v2 does not store the raw quote, so history or a paste is still required for TCB status.
2. Publish `glassbox-mcp` if the owner wants `npx glassbox-mcp`. Do not publish without being asked.
3. Restyle `apps/web` and, only when asked, deploy to Vercel Hobby (personal, non-commercial, no ads).
4. Optional measurement work: dstack-mr can hash older images (0.5.0–0.5.11, 0.6.0). Until those hashes are reproduced, leave them out of the fixed list. A reproduced vulnerable hash may be added as a known non-fixed image, with the source, and the sentence stays "not a known fixed image" or "matches a vulnerable configuration".
5. Hackathon items that are not code: the repo has to be public, the user posts on X with `@NEARProtocol` and `#NEARHackathon`, the user creates the mainnet payout account, and the submission POST waits for the user to confirm the payload. Deadline cited in the notes: 2026-11-14T23:59Z. Do not post or submit on the user's behalf.

## Files worth opening first

- `packages/core/src/audit.ts` — collect
- `packages/core/src/report.ts` — ladder copy
- `packages/core/src/checks/dstack.ts` — version rules
- `packages/core/src/checks/tdx.ts` — quote verify
- `NOTICE` — Apache-2.0 credits that must stay
