import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_MAX_PER_WINDOW, resetAuditLimiter, takeAuditSlot } from "./limit.js";

test("the audit limiter stops after the window quota", () => {
  resetAuditLimiter();
  const now = 1_700_000_000_000;
  for (let i = 0; i < AUDIT_MAX_PER_WINDOW; i += 1) {
    assert.equal(takeAuditSlot(now), true);
  }
  assert.equal(takeAuditSlot(now), false);
  assert.equal(takeAuditSlot(now + 60_001), true);
  resetAuditLimiter();
});
