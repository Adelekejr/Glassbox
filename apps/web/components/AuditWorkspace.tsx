"use client";

import { useState, type ReactNode } from "react";
import { AuditForm } from "./AuditForm";
import { emptyHeldReport, type HeldReport } from "../lib/audit-client";
import { Ladder, type AuditPayload } from "./Ladder";

/** Owns the audit result so the form (hero) and the report (section 01) can sit in different sections. */
export function AuditWorkspace({ intro, strip }: { intro: ReactNode; strip: ReactNode }) {
  const [held, setHeld] = useState<HeldReport<AuditPayload>>(emptyHeldReport);
  const pendingNote = held.pending && held.report
    ? "Reading a new audit. The report below stays until this one finishes."
    : null;
  return (
    <>
      <section className="hero" id="audit" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div>
            {intro}
            <AuditForm held={held} onHeld={(update) => setHeld((current) => update(current))} />
          </div>
          {strip}
        </div>
      </section>

      <section className="section" id="report-section" aria-labelledby="report-title">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="idx label"><span className="n">01</span><span>Report</span></div>
              <h2 id="report-title" className="reveal">One report. Every finding on the ladder.</h2>
            </div>
            <p className="reveal">
              Each line is plain English and, where a chain fact exists, links to it. The tool does not send
              transactions. It can sign a report file on your computer. That key stays on that computer.
            </p>
          </div>
          <div aria-live="polite">
            {pendingNote ? <p className="report-status" role="status">{pendingNote}</p> : null}
            {held.notice ? (
              <p className={`report-status${held.noticeKind === "error" ? " is-error" : ""}`} role={held.noticeKind === "error" ? "alert" : "status"}>
                {held.notice}
              </p>
            ) : null}
            {held.report ? (
              <Ladder key={(held.report.report.target ?? "") + (held.report.report.generatedAt ?? "") + held.source} payload={held.report} />
            ) : (
              <div className="frame report-empty">
                <span className="glyph lg NOT_PROVEN" aria-hidden="true" />
                <div>
                  <p className="report-empty-title">{held.pending ? "Reading." : "No report yet."}</p>
                  <p>
                    {held.pending
                      ? "A live account often takes about half a minute. This page stops waiting after 3 minutes."
                      : "Paste an account or JSON above and select Audit. The ladder appears here."}
                  </p>
                </div>
                <a className="btn btn-quiet btn-sm" href="#audit">Go to the form</a>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
