import test from "node:test";
import assert from "node:assert/strict";
import { lookupIssue } from "../dist/js/handler.js";

const envelope = (input, endpoints = [{ name: "issues", handle: "opaque-approval", baseUrl: "https://issues.example.test" }]) => ({
  kind: "tools", contributionId: "issue-lookup", configuration: { endpointName: "issues" }, input,
  context: { endpoints }
});

function brokerFor(responseBody = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "DEMO-17 is open" }] } }) {
  const bytes = new TextEncoder().encode(JSON.stringify(responseBody));
  let read = false;
  const calls = [];
  return {
    calls,
    httpStart(request) { calls.push(["start", request]); return { ok: true, value: 17 }; },
    httpStatus(handle) { calls.push(["status", handle]); return { ok: true, value: 200 }; },
    httpResponseHeaders(handle) { calls.push(["headers", handle]); return { ok: true, value: [{ name: "Content-Type", value: "application/json" }] }; },
    httpRead(handle, max) { calls.push(["read", handle, max]); if (read) return { ok: true, value: undefined }; read = true; return { ok: true, value: bytes }; },
    httpCancel(handle) { calls.push(["cancel", handle]); },
    httpDrop(handle) { calls.push(["drop", handle]); }
  };
}

test("calls the configured approved endpoint and returns bounded MCP text", () => {
  const broker = brokerFor();
  assert.deepEqual(lookupIssue(envelope({ issueKey: "DEMO-17" }), broker), { issueKey: "DEMO-17", summary: "DEMO-17 is open" });
  const request = broker.calls.find(([kind]) => kind === "start")[1];
  assert.equal(request.url, "https://issues.example.test/mcp");
  assert.equal(request.endpointHandle, "opaque-approval");
  assert.equal(request.method, "POST");
  const body = JSON.parse(new TextDecoder().decode(request.body));
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.arguments.issueKey, "DEMO-17");
  assert.equal(broker.calls.at(-1)[0], "drop");
});

test("refuses missing host approval and malformed issue keys before network access", () => {
  const broker = brokerFor();
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-0" }), broker), /issue_key_invalid/);
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }, []), broker), /approved_issues_endpoint_missing/);
  assert.equal(broker.calls.length, 0);
});

test("rejects mismatched JSON-RPC responses and always cancels and drops the handle", () => {
  const broker = brokerFor({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "bad" }] } });
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }), broker), /mcp_call_failed/);
  assert.deepEqual(broker.calls.slice(-2).map(([kind]) => kind), ["cancel", "drop"]);
});

test("bounds response bytes and detects a broker that never makes read progress", () => {
  const oversized = brokerFor({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "x".repeat(140 * 1024) }] } });
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }), oversized), /mcp_response_too_large/);
  assert.deepEqual(oversized.calls.slice(-2).map(([kind]) => kind), ["cancel", "drop"]);

  let reads = 0;
  const stalled = brokerFor();
  stalled.httpRead = (handle, max) => { reads++; return { ok: true, value: new Uint8Array(0) }; };
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }), stalled), /mcp_response_stalled/);
  assert.equal(reads, 33);
  assert.deepEqual(stalled.calls.slice(-2).map(([kind]) => kind), ["cancel", "drop"]);
});

test("rejects terminal newlines, missing text, false JSON media types, and UTF-8 byte overflow", () => {
  const invalidInput = brokerFor();
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17\n" }), invalidInput), /issue_key_invalid/);
  assert.equal(invalidInput.calls.length, 0);

  const missingText = brokerFor({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text" }] } });
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }), missingText), /mcp_result_content_invalid/);

  const falseMediaType = brokerFor();
  falseMediaType.httpResponseHeaders = () => ({ ok: true, value: [{ name: "content-type", value: "application/jsonp" }] });
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }), falseMediaType), /mcp_content_type_invalid/);

  const oversizedUtf8 = brokerFor({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "é".repeat(33 * 1024) }] } });
  assert.throws(() => lookupIssue(envelope({ issueKey: "DEMO-17" }), oversizedUtf8), /mcp_result_content_invalid/);
});
