"use client";

import { useState, type ReactNode } from "react";
import { AuditForm } from "./AuditForm";
import { Ladder, type AuditPayload } from "./Ladder";

/** Owns the audit result so the form (hero) and the report (section 01) can sit in different sections. */
export function AuditWorkspace({ intro, strip }: { intro: ReactNode; strip: ReactNode }) {
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  return (
    <>
      <section className="hero" id="audit" aria-labelledby="hero-title">
        <div className="wrap hero-grid">
          <div>
            {intro}
            <AuditForm onResult={setPayload} />
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
            {payload ? (
              <Ladder key={payload.report.target + payload.report.generatedAt} payload={payload} />
            ) : (
              <div className="frame report-empty">
                <span className="glyph lg NOT_PROVEN" aria-hidden="true" />
                <div>
                  <p className="report-empty-title">No report yet.</p>
                  <p>Paste an account or JSON above and select Audit. The ladder appears here.</p>
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
