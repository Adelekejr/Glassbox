import assert from "node:assert/strict";
import test from "node:test";
import { securityHeaders } from "./headers.js";

test("security headers stay same-origin and do not force https on local http", () => {
  const headers = Object.fromEntries(securityHeaders.map((header) => [header.key, header.value]));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Strict-Transport-Security"], undefined);
  const csp = headers["Content-Security-Policy"];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(csp, /\*/);
});
