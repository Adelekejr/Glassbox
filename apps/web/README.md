# apps/web

Minimal Next.js form for Glassbox. Plain styling. The visual design comes later; keep `components/Ladder.tsx` and `components/AuditForm.tsx` as the restyle points.

Do run it locally — see `pnpm --filter web dev`. Do not deploy.

The page posts to `/api/audit`. The route accepts a NEAR account id or JSON text and does not read local files. Paste an account (the hint reads `.testnet` / `.near`) or a JSON document.
