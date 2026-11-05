import assert from "node:assert/strict";
import test from "node:test";
import { classifyWebTarget, describeInput, isNearAccountId } from "./network.js";

test("web targets are account ids or JSON, never file paths", () => {
  assert.equal(isNearAccountId("ac-sandbox.votron.testnet"), true);
  assert.equal(isNearAccountId("v1.signer"), true);
  assert.equal(isNearAccountId("a"), false);
  assert.equal(isNearAccountId("Foo.near"), false);
  assert.equal(classifyWebTarget("ac-sandbox.votron.testnet").kind, "account");
  assert.equal(classifyWebTarget("  {\"kind\":\"x\"}").kind, "json");
  assert.equal(classifyWebTarget("[1]").kind, "json");
  for (const path of ["/etc/passwd", "../.env", "..\\secrets.json", "C:\\keys.pem", "has space", ""]) {
    const result = classifyWebTarget(path);
    assert.equal(result.kind, "reject", path);
  }
  // These match the account-id grammar. The route must query them as accounts and not open files.
  for (const account of ["package.json", "notes.md"]) {
    const result = classifyWebTarget(account);
    assert.equal(result.kind, "account", account);
  }
});

test("the form hint separates a live account, pasted JSON, and a CLI file", () => {
  assert.match(describeInput(""), /does not read a local file/);
  assert.match(describeInput("ac-sandbox.votron.testnet"), /Live account on testnet/);
  assert.match(describeInput('{"kind":"glassbox-capture"}'), /Pasted JSON/);
  assert.match(describeInput('{"kind":"glassbox-capture"}'), /not a CLI local file/);
  assert.doesNotMatch(describeInput("ac-sandbox.votron.testnet"), /CLI local file/);
});
