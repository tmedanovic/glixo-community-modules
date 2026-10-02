import test from "node:test";
import assert from "node:assert/strict";
import { guest, previewText, redact } from "../dist/js/guest.js";

const rules = [
  { match: "PERSONAL-ACCOUNT-1234", replacement: "[account]" },
  { match: "東京", replacement: "[city]" }
];

test("preview applies ordered literal unicode rules", () => {
  assert.equal(previewText("PERSONAL-ACCOUNT-1234 in 東京", rules), "[account] in [city]");
  assert.equal(previewText("a$b", [{ match: "a", replacement: "$&" }]), "$&$b");
});

test("guest patches only non-authority user text", () => {
  const response = redact({ schemaVersion: 1, operation: "before-provider", conversation: { messages: [
    { id: "m0", role: "user", isHostAuthority: false, parts: [
      { id: "p0", kind: "text", text: "PERSONAL-ACCOUNT-1234 at 東京" },
      { id: "p1", kind: "image", text: "PERSONAL-ACCOUNT-1234" }
    ] },
    { id: "m1", role: "assistant", isHostAuthority: false, parts: [{ id: "p0", kind: "text", text: "PERSONAL-ACCOUNT-1234" }] },
    { id: "m2", role: "user", isHostAuthority: true, parts: [{ id: "p0", kind: "text", text: "PERSONAL-ACCOUNT-1234" }] },
    { id: "m3", role: "tool", isHostAuthority: false, parts: [{ id: "p0", kind: "text", text: "PERSONAL-ACCOUNT-1234" }] }
  ] } }, { rules });
  assert.deepEqual(response.textPatches, [{ messageId: "m0", partId: "p0", text: "[account] at [city]" }]);
  assert.equal(response.auditDescription, "redaction-applied");
  assert.equal(JSON.stringify(response).includes("PERSONAL-ACCOUNT-1234"), false);
});

test("generic guest ABI returns a direct string or a bounded primitive WIT error", () => {
  const request = JSON.stringify({ kind: "messageMiddleware", contributionId: "prompt-redactor", configuration: { rules }, input: {
    schemaVersion: 1, operation: "before-provider", conversation: { messages: [] }
  } });
  assert.equal(typeof guest.invoke(request), "string");
  assert.throws(() => guest.invoke("not-json"), (error) => error === "guest_envelope_invalid");
  const invalidConfiguration = JSON.stringify({ kind: "messageMiddleware", contributionId: "prompt-redactor", configuration: {}, input: {
    schemaVersion: 1, operation: "before-provider", conversation: { messages: [] }
  } });
  assert.throws(() => guest.invoke(invalidConfiguration), (error) => error === "redaction_rules_invalid");
});

test("empty rules produce an auditable no-op", () => {
  const response = redact({ schemaVersion: 1, operation: "before-provider", conversation: { messages: [
    { id: "m0", role: "user", isHostAuthority: false, parts: [{ id: "p0", kind: "text", text: "safe" }] }
  ] } }, { rules: [] });
  assert.deepEqual(response.textPatches, []);
  assert.equal(response.auditDescription, "no-change");
});

test("missing rules configuration fails closed", () => {
  assert.throws(() => redact({ schemaVersion: 1, operation: "before-provider", conversation: { messages: [] } }, {}), /redaction_rules_invalid/);
});
