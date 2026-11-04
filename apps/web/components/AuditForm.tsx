"use client";

import { useMemo, useState } from "react";
import { Ladder, type AuditPayload } from "./Ladder";
import { describeInput } from "../lib/network";

export function AuditForm() {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const hint = useMemo(() => describeInput(target), [target]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setPayload(null);
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const body = (await response.json()) as AuditPayload & { error?: string };
      if (!response.ok) {
        setError(body.error || `Request failed (${response.status}).`);
        return;
      }
      setPayload(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The audit request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <label htmlFor="target">Account or JSON</label>
        <textarea
          id="target"
          name="target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="ac-sandbox.votron.testnet"
          spellCheck={false}
        />
        <p className="hint">{hint}</p>
        <div className="row">
          <button type="submit" disabled={busy || target.trim().length === 0}>
            {busy ? "Reading…" : "Audit"}
          </button>
        </div>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {payload ? <Ladder payload={payload} /> : null}
    </>
  );
}
