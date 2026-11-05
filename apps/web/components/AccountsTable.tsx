"use client";

import { Fragment, useState } from "react";
import { Caret } from "./Icons";
import { LadderBar } from "./LadderBar";

type Rung = "RISKY" | "NOT_PROVEN" | "PROVEN";
const ORDER: Rung[] = ["RISKY", "NOT_PROVEN", "PROVEN"];
const LABEL: Record<Rung, string> = { RISKY: "RISKY", NOT_PROVEN: "NOT PROVEN", PROVEN: "PROVEN" };

export interface IndexRow {
  accountId: string;
  network: string;
  shade: string;
  overall: string;
  bucket: string;
  configurationClass: string;
  summary: { proven: number; notProven: number; risky: number };
  findings: { id: string; ladder: string; title: string }[];
  evidence?: { label: string; detail?: string }[];
}

export function AccountsTable({ rows }: { rows: IndexRow[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const flip = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  return (
    <table className="acct-table reveal">
      <caption className="sr">Accounts in the saved seven-account snapshot. Select a row to see its findings. Smoke and MPC targets are not in this list.</caption>
      <colgroup>
        <col className="w-id" /><col className="w-net" /><col className="w-shade" /><col className="w-overall" /><col className="w-bar" /><col className="w-counts" />
      </colgroup>
      <thead>
        <tr>
          <th className="label" scope="col">Account</th>
          <th className="label" scope="col">Network</th>
          <th className="label" scope="col">Interface</th>
          <th className="label" scope="col">Overall</th>
          <th className="label" scope="col">Ladder</th>
          <th className="label" scope="col">Counts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const isOpen = !!open[r.accountId];
          const overall = r.overall as Rung;
          return (
            <Fragment key={r.accountId}>
              <tr className="acct-row" aria-expanded={isOpen} onClick={() => flip(r.accountId)}>
                <td className="c-id">
                  <div className="id">
                    <button type="button" aria-expanded={isOpen} aria-controls={`d-${i}`} onClick={(e) => { e.stopPropagation(); flip(r.accountId); }}>
                      <Caret className="caret" />
                      <span>{r.accountId}</span>
                    </button>
                  </div>
                </td>
                <td className="c-net"><span className="sm">{r.network}</span></td>
                <td className="c-shade"><span className="sm">{r.shade}</span></td>
                <td className="c-overall"><span className={`rung-badge ${overall}`}><span className={`glyph ${overall}`} aria-hidden="true" />{LABEL[overall]}</span></td>
                <td className="c-bar"><LadderBar summary={r.summary} /></td>
                <td className="c-counts">
                  <span className="counts"><span className="r">{r.summary.risky}</span> · <span className="n">{r.summary.notProven}</span> · <span className="p">{r.summary.proven}</span></span>
                </td>
              </tr>
              <tr className="acct-detail" id={`d-${i}`} hidden={!isOpen}>
                <td colSpan={6}>
                  <p style={{ fontSize: ".875rem", color: "var(--text-2)", paddingTop: 12 }}>
                    Configuration class: <strong style={{ color: "var(--text)", fontWeight: 500 }}>{r.configurationClass}</strong>
                  </p>
                  <div className="detail-grid">
                    {ORDER.map((k) => {
                      const g = r.findings.filter((f) => f.ladder === k);
                      return (
                        <div key={k}>
                          <h4 className="label"><span className={`glyph ${k}`} aria-hidden="true" />{LABEL[k]} · {g.length}</h4>
                          <ul>{g.map((f) => <li key={f.id}>{f.title}</li>)}</ul>
                        </div>
                      );
                    })}
                  </div>
                  <div className="detail-ev">
                    {(r.evidence ?? []).map((e, j) => (
                      <span key={j}>{e.label}{e.detail ? ` · ${e.detail}` : ""}</span>
                    ))}
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
