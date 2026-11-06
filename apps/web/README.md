# apps/web

Minimal Next.js form for Glassbox. Plain styling. The visual design comes later; keep `components/Ladder.tsx` and `components/AuditForm.tsx` as the restyle points.

The public site is https://glassbox-inky.vercel.app. You can also run it on your computer with `pnpm --filter web dev`.

The page posts to `/api/audit`. The route accepts a NEAR account id or JSON text and does not read local files. The preferred production limiter is Upstash Redis: set both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_URL` / `KV_REST_API_TOKEN` pair). When that store is present, admission uses the shared budget of 10 audits per minute and 2 at a time for the whole deployment, including when the demo flag is also set. When `GLASSBOX_AUDIT_TOKEN` is set and no shared store is configured, callers must send header `x-glassbox-audit-token`. `GLASSBOX_PUBLIC_DEMO=1` is process-local demo mode. It keeps the anonymous form working with a cap of 10 per minute in that one process; that cap is not shared across serverless instances. The public demo uses this flag until those Redis variables are set. With none of those set, the route returns 403 and does not call RPC. Paste an account (the hint reads `.testnet` / `.near`) or a JSON document. A pasted JSON report compares values in that text. It is not a fresh chain read, except that a quote in the text is verified as those bytes.

The top of the page is the proof strip from `data/proof-strip.json`, a dated saved seven-account snapshot. Rebuild that file from the repo root with `node packages/cli/bin/glassbox.js index` or, for those seven accounts, `glassbox index --live`. Smoke and MPC targets are not in that file.
