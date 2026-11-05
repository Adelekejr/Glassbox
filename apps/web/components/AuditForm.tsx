"use client";

import { useMemo, useRef, useState } from "react";
import { type AuditPayload } from "./Ladder";
import { classifyWebTarget, describeInput, detectNetwork } from "../lib/network";

const EXAMPLES = ["ac-sandbox.votron.testnet", "reflect-adam-mainnet-agent-contract.near", "ironshield.near"];

function hintTag(value: string): string | null {
  const c = classifyWebTarget(value);
  if (!value.trim() || c.kind === "reject") return null;
  if (c.kind === "json") return "JSON";
  return detectNetwork(c.accountId) ?? "mainnet → testnet";
}

export function AuditForm({ onResult }: { onResult: (payload: AuditPayload | null) => void }) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hint = useMemo(() => describeInput(target), [target]);
  const tag = useMemo(() => hintTag(target), [target]);
  const invalid = target.trim().length > 0 && classifyWebTarget(target).kind === "reject";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !target.trim()) return;
    setBusy(true);
    setError("");
    onResult(null);
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
      onResult(body);
      requestAnimationFrame(() => document.getElementById("report-section")?.scrollIntoView({ behavior: "smooth" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The audit request failed.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const first = target.trim()[0];
    if (event.key === "Enter" && !event.shiftKey && first !== "{" && first !== "[") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className="audit frame reveal" onSubmit={onSubmit} noValidate>
      <label className="field-label" htmlFor="target">
        <span>Account or JSON</span>
        <span className="label">.testnet / .near / JSON</span>
      </label>
      <div className="input-row">
        <textarea
          ref={inputRef}
          className="input"
          id="target"
          name="target"
          rows={1}
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setError("");
          }}
          onKeyDown={onKeyDown}
          placeholder="ac-sandbox.votron.testnet"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-describedby="target-hint"
          aria-invalid={invalid}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || target.trim().length === 0} aria-busy={busy || undefined}>
          <svg className="loader" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="9" y="0" width="7" height="7" rx="2" />
            <rect x="9" y="9" width="7" height="7" rx="2" />
            <rect x="0" y="9" width="7" height="7" rx="2" />
            <rect x="0" y="0" width="7" height="7" rx="2" />
          </svg>
          <span className="btn-text">{busy ? "Reading…" : "Audit"}</span>
        </button>
      </div>
      <p className={`hint${invalid ? " is-error" : ""}`} id="target-hint" aria-live="polite">
        {tag ? <span className="net">{tag}</span> : null}
        <span>{hint}</span>
      </p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="examples">
        <span className="label">Examples</span>
        {EXAMPLES.map((id) => (
          <button
            key={id}
            className="chip"
            type="button"
            onClick={() => {
              setTarget(id);
              inputRef.current?.focus();
            }}
          >
            {id}
          </button>
        ))}
      </div>
      <p className="examples-note">
        ironshield.near is a Shade v2 interface in the saved index. That row loaded no registration quote and no
        approved measurements. Those checks stay not proven.
      </p>
    </form>
  );
}
