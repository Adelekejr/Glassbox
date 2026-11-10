import assert from "node:assert/strict";
import test from "node:test";
import { parseHealthStatus, unknownHealth } from "./health-status.js";

const checkedAt = "2026-11-10T07:15:00.000Z";

function row(ok: boolean, id = "audit-votron") {
  return {
    id,
    name: id,
    ok,
    detail: ok ? "HTTP 200. History loaded." : "history read failed",
    checkedAt,
  };
}

test("a file where every check passed is green only then", () => {
  const view = parseHealthStatus({
    version: 1,
    updatedAt: checkedAt,
    runUrl: "https://github.com/Adelekejr/Glassbox/actions/runs/42",
    checks: [row(true, "audit-votron"), row(true, "nearblocks")],
  });
  assert.equal(view.state, "passing");
  assert.equal(view.label, "All checks passing");
  assert.equal(view.checkedLabel, "Last checked 10 Nov 2026, 07:15 UTC");
  assert.equal(view.runUrl, "https://github.com/Adelekejr/Glassbox/actions/runs/42");
  assert.equal(view.checks.length, 2);
});

test("one failed check is failing, and a bad file is unknown rather than passing", () => {
  const failing = parseHealthStatus({
    runUrl: "https://github.com/Adelekejr/Glassbox/actions/runs/7",
    checks: [row(true), row(false, "nearblocks")],
  });
  assert.equal(failing.state, "failing");
  assert.equal(failing.label, "Check failing");

  for (const value of [null, {}, { checks: [] }, { checks: [{ id: "x", name: "x", ok: "true", detail: "x", checkedAt }] }, "passing"]) {
    const view = parseHealthStatus(value);
    assert.equal(view.state, "unknown");
    assert.equal(view.label, "Status unknown");
    assert.equal(view.checkedLabel, "Last checked unknown");
    assert.deepEqual(view, unknownHealth());
  }

  const oddUrl = parseHealthStatus({
    runUrl: "javascript:alert(1)",
    checks: [row(true)],
  });
  assert.equal(oddUrl.state, "passing");
  assert.equal(oddUrl.runUrl, null);
});
