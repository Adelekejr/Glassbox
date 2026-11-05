import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_CLIENT_TIMEOUT_MS,
  auditTimeoutNotice,
  beginAudit,
  emptyHeldReport,
  failAudit,
  showSavedSample,
  stopWaiting,
  succeedAudit,
} from "./audit-client.js";

test("a new audit keeps the previous report until a result arrives", () => {
  const previous = succeedAudit(emptyHeldReport<string>(), "first");
  const pending = beginAudit(previous);
  assert.equal(pending.report, "first");
  assert.equal(pending.pending, true);
  assert.equal(pending.source, "audit");

  const failed = failAudit(pending, auditTimeoutNotice(true));
  assert.equal(failed.report, "first");
  assert.equal(failed.pending, false);
  assert.match(failed.notice ?? "", /unchanged/);
  assert.match(failed.notice ?? "", /Select Audit to try again/);

  const next = succeedAudit(failed, "second");
  assert.equal(next.report, "second");
  assert.equal(next.notice, null);
});

test("a saved sample is labelled and is replaced only by a finished audit", () => {
  const sample = showSavedSample(emptyHeldReport<string>(), "sample-report", "Saved sample. Not a live account.");
  assert.equal(sample.source, "sample");
  assert.match(sample.notice ?? "", /Not a live account/);

  const pending = beginAudit(sample);
  assert.equal(pending.report, "sample-report");
  assert.equal(pending.noticeKind, "sample");
  const stopped = stopWaiting(pending);
  assert.equal(stopped.pending, false);
  assert.equal(stopped.report, "sample-report");

  const failed = failAudit(pending, auditTimeoutNotice(true));
  assert.equal(failed.report, "sample-report");
  assert.equal(failed.source, "sample");
  assert.equal(failed.noticeKind, "sample");
  assert.match(failed.notice ?? "", /Not a live account/);
});

test("the client wait is one bound, longer than the documented half-minute read", () => {
  assert.equal(AUDIT_CLIENT_TIMEOUT_MS, 180_000);
  assert.match(auditTimeoutNotice(false), /3 minutes/);
  assert.doesNotMatch(auditTimeoutNotice(false), /stage|step \d/i);
});
