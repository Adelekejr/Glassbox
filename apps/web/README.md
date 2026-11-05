# apps/web

Minimal Next.js form for Glassbox. Plain styling. The visual design comes later; keep `components/Ladder.tsx` and `components/AuditForm.tsx` as the restyle points.

Do run it locally — see `pnpm --filter web dev`. Do not deploy.

The page posts to `/api/audit`. The route accepts a NEAR account id or JSON text and does not read local files. Paste an account (the hint reads `.testnet` / `.near`) or a JSON document.

The top of the page is the proof strip from `data/proof-strip.json`. Rebuild that file from the repo root with `node packages/cli/bin/glassbox.js index` or, for the known accounts, `glassbox index --live`.
