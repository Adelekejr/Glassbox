"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type AuditPayload } from "./Ladder";
import {
  AUDIT_CLIENT_TIMEOUT_MS,
  auditHttpNotice,
  auditNetworkNotice,
  auditTimeoutNotice,
  beginAudit,
  failAudit,
  showSavedSample,
  stopWaiting,
  succeedAudit,
  type HeldReport,
} from "../lib/audit-client";
import { classifyWebTarget, describeInput, detectNetwork } from "../lib/network";

const EXAMPLES = ["ac-sandbox.votron.testnet", "reflect-adam-mainnet-agent-contract.near", "ironshield.near"];

function hintTag(value: string): string | null {
  const c = classifyWebTarget(value);
  if (!value.trim() || c.kind === "reject") return null;
  if (c.kind === "json") return "Pasted JSON";
  return detectNetwork(c.accountId) ?? "mainnet → testnet";
}

export function AuditForm({
  held,
  onHeld,
}: {
  held: HeldReport<AuditPayload>;
  onHeld: (update: (current: HeldReport<AuditPayload>) => HeldReport<AuditPayload>) => void;
}) {
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const heldRef = useRef(held);
  heldRef.current = held;
  const hint = useMemo(() => describeInput(target), [target]);
  const tag = useMemo(() => hintTag(target), [target]);
  const invalid = target.trim().length > 0 && classifyWebTarget(target).kind === "reject";

  useEffect(() => {
    return () => {
      requestId.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (held.pending || !target.trim()) return;
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), AUDIT_CLIENT_TIMEOUT_MS);
    setError("");
    onHeld(beginAudit);
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target }),
        signal: controller.signal,
      });
      if (id !== requestId.current) return;
      const body = (await response.json()) as AuditPayload & { error?: string };
      if (!response.ok) {
        const notice = auditHttpNotice(response.status, body.error, heldRef.current.report !== null);
        setError(notice);
        onHeld((current) => failAudit(current, notice));
        return;
      }
      onHeld((current) => succeedAudit(current, body));
      requestAnimationFrame(() => document.getElementById("report-section")?.scrollIntoView({ behavior: "smooth" }));
    } catch (cause) {
      if (id !== requestId.current) return;
      const kept = heldRef.current.report !== null;
      const notice = controller.signal.aborted ? auditTimeoutNotice(kept) : auditNetworkNotice(cause, kept);
      setError(notice);
      onHeld((current) => failAudit(current, notice));
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function onSample() {
    const id = ++requestId.current;
    abortRef.current?.abort();
    abortRef.current = null;
    setError("");
    onHeld(stopWaiting);
    try {
      const response = await fetch("/saved-sample.json");
      if (id !== requestId.current) return;
      const kept = heldRef.current.report !== null;
      if (!response.ok) {
        const notice = auditHttpNotice(response.status, "The saved sample could not be loaded.", kept);
        setError(notice);
        onHeld((current) => failAudit(current, notice));
        return;
      }
      const body = (await response.json()) as { notice?: string; payload?: AuditPayload };
      if (id !== requestId.current) return;
      if (!body.payload || typeof body.notice !== "string") {
        const notice = auditHttpNotice(response.status, "The saved sample could not be loaded.", kept);
        setError(notice);
        onHeld((current) => failAudit(current, notice));
        return;
      }
      onHeld((current) => showSavedSample(current, body.payload as AuditPayload, body.notice as string));
      requestAnimationFrame(() => document.getElementById("report-section")?.scrollIntoView({ behavior: "smooth" }));
    } catch (cause) {
      if (id !== requestId.current) return;
      const notice = auditNetworkNotice(cause, heldRef.current.report !== null);
      setError(notice);
      onHeld((current) => failAudit(current, notice));
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
        <span className="label">Live account / pasted JSON</span>
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
        <button className="btn btn-primary" type="submit" disabled={held.pending || target.trim().length === 0} aria-busy={held.pending || undefined}>
          <svg className="loader" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="9" y="0" width="7" height="7" rx="2" />
            <rect x="9" y="9" width="7" height="7" rx="2" />
            <rect x="0" y="9" width="7" height="7" rx="2" />
            <rect x="0" y="0" width="7" height="7" rx="2" />
          </svg>
          <span className="btn-text">{held.pending ? "Reading…" : "Audit"}</span>
        </button>
      </div>
      <p className={`hint${invalid ? " is-error" : ""}`} id="target-hint" aria-live="polite">
        {tag ? <span className="net">{tag}</span> : null}
        <span>{hint}</span>
      </p>
      {held.pending ? (
        <p className="examples-note" role="status">
          A live account often takes about half a minute. This page stops waiting after 3 minutes.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="examples">
        <span className="label">Live examples</span>
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
        <button className="chip is-file" type="button" onClick={onSample}>
          Saved sample
        </button>
      </div>
      <p className="examples-note">
        Account chips are live reads. Saved sample is the offline votron capture, not a live account. JSON in the box is
        pasted text, not a CLI local file. ironshield.near is a Shade v2 interface in the saved seven-account snapshot.
        That row loaded no registration quote and no approved measurements. Those checks stay not proven.
      </p>
    </form>
  );
}
