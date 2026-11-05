"use client";

import { useRef, useState, type ReactNode } from "react";
import { CopyIcon } from "./Icons";

type Line = { kind: "c" | "cmd" | "raw"; text: string };
type Surface = { id: string; title: string; tag: string; sub: string; file: string; lines: Line[]; note: ReactNode };

const SURFACES: Surface[] = [
  {
    id: "cli", title: "Command line", tag: "glassbox", file: "Terminal",
    sub: "Audit an account or a file, print JSON, sign, verify, diff.",
    lines: [
      { kind: "c", text: "# install and test (Node 20+)" },
      { kind: "cmd", text: "pnpm install" },
      { kind: "cmd", text: "pnpm test" },
      { kind: "raw", text: "" },
      { kind: "c", text: "# audit the captured votron registration on testnet" },
      { kind: "cmd", text: "pnpm --filter cli start ac-sandbox.votron.testnet" },
      { kind: "raw", text: "" },
      { kind: "c", text: "# the same report as JSON" },
      { kind: "cmd", text: "pnpm --filter cli start ac-sandbox.votron.testnet --json" },
      { kind: "raw", text: "" },
      { kind: "c", text: "# audit a file offline" },
      { kind: "cmd", text: "node packages/cli/bin/glassbox.js packages/core/test/fixtures/votron-registration.json" },
    ],
    note: <>The first live read spends about half a minute. History comes from NearBlocks, and Glassbox waits between those calls so it stays inside the free personal-use limit (about 6 per minute).</>,
  },
  {
    id: "mcp", title: "Agent tool", tag: "check_agent", file: ".cursor/mcp.json",
    sub: "Stdio MCP server. One tool. Returns the same ladder as JSON.",
    lines: [{ kind: "raw", text: `{\n  "mcpServers": {\n    "glassbox": {\n      "command": "node",\n      "args": ["/ABSOLUTE/PATH/Glassbox/packages/mcp/bin/glassbox-mcp.js"]\n    }\n  }\n}` }],
    note: <><code>check_agent</code> takes a NEAR account or pasted JSON. It returns the same ladder as JSON, a one-sentence summary, and <code>overall</code> (the highest rung). Stdio transport. Publishing <code>glassbox-mcp</code> to npm is not part of this submission.</>,
  },
  {
    id: "web", title: "Web form", tag: "deployed", file: "Public site",
    sub: "This page is on the public site. You can also run it on your computer.",
    lines: [
      { kind: "c", text: "# public site" },
      { kind: "raw", text: "https://glassbox-inky.vercel.app" },
      { kind: "raw", text: "" },
      { kind: "c", text: "# same form on your computer" },
      { kind: "cmd", text: "pnpm --filter web dev" },
      { kind: "c", text: "# then open http://localhost:3000" },
    ],
    note: <>This page POSTs to <code>/api/audit</code>, which calls the core library and does not read local files. One process accepts 10 audits per rolling minute, then HTTP 429. That cap is per server process. It resets on restart and is not shared by every visitor.</>,
  },
];

export function Surfaces() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKey(event: React.KeyboardEvent, i: number) {
    const d = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    event.preventDefault();
    const n = (i + d + SURFACES.length) % SURFACES.length;
    setActive(n);
    tabs.current[n]?.focus();
  }

  function copy(s: Surface) {
    const text = s.lines.map((l) => l.text).join("\n");
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1400); };
    navigator.clipboard?.writeText(text).then(done, done);
  }

  return (
    <div className="surfaces">
      <div className="tablist" role="tablist" aria-label="Where to ask">
        {SURFACES.map((s, i) => (
          <button
            key={s.id}
            ref={(el) => { tabs.current[i] = el; }}
            className="tab" role="tab" id={`tab-${s.id}`} aria-controls={`panel-${s.id}`}
            aria-selected={active === i} tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)} onKeyDown={(e) => onKey(e, i)}
          >
            <span className="t">{s.title}</span>
            <span className="label">{s.tag}</span>
            <span className="s">{s.sub}</span>
          </button>
        ))}
      </div>
      <div>
        {SURFACES.map((s, i) => (
          <div key={s.id} className="panel" role="tabpanel" id={`panel-${s.id}`} aria-labelledby={`tab-${s.id}`} hidden={active !== i}>
            <div className="code">
              <div className="code-head">
                <span className="label">{s.file}</span>
                <button className="btn btn-quiet btn-sm copy" type="button" onClick={() => copy(s)}>
                  <CopyIcon /><span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre>
                {s.lines.map((l, j) => (
                  <span key={j}>
                    {l.kind === "c" ? <span className="c">{l.text}</span> : l.kind === "cmd" ? <><span className="p">$ </span><span className="k">{l.text}</span></> : <span className="k">{l.text}</span>}
                    {j < s.lines.length - 1 ? "\n" : null}
                  </span>
                ))}
              </pre>
            </div>
            <p className="panel-note">{s.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
