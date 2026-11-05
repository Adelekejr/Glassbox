# apps/web

Minimal Next.js form for Glassbox. Plain styling. The visual design comes later; keep `components/Ladder.tsx` and `components/AuditForm.tsx` as the restyle points.

Do run it locally — see `pnpm --filter web dev`. Do not deploy.

The page posts to `/api/audit`. The route accepts a NEAR account id or JSON text and does not read local files. One process accepts 10 audits per rolling minute, then HTTP 429. That cap is not a deploy control. Keep the server on localhost until a deliberate deploy. Paste an account (the hint reads `.testnet` / `.near`) or a JSON document. A pasted JSON report compares values in that text. It is not a fresh chain read, except that a quote in the text is verified as those bytes.

The top of the page is the proof strip from `data/proof-strip.json`. Rebuild that file from the repo root with `node packages/cli/bin/glassbox.js index` or, for the known accounts, `glassbox index --live`.
