import test from "node:test";
import assert from "node:assert/strict";
import { analyze, guest } from "../dist/js/guest.js";

test("completed observation separates provider usage from estimated text size", () => {
  const result = analyze({ schemaVersion: 1, operation: "completed", completion: {
    latencyMilliseconds: 123, userMessageCount: 2, assistantMessageCount: 1,
    toolCallCount: 1, toolResultCount: 1, attachmentCount: 0,
    actualUsage: { inputTokens: 31, outputTokens: 12, totalTokens: 43 },
    estimatedInputCharacters: 250, estimatedOutputCharacters: 82
  } });
  assert.deepEqual(result.observation.actualUsage, {
    inputTokens: 31, outputTokens: 12, cachedTokens: null, reasoningTokens: null, totalTokens: 43
  });
  assert.equal(result.observation.textStatisticsAreEstimates, true);
  assert.equal(JSON.stringify(result).includes("prompt"), false);
});

test("committed observation uses metadata only", () => {
  const result = analyze({ schemaVersion: 1, operation: "committed", committedMessage: {
    role: "user", attachmentCount: 1, toolCallCount: 0, toolResultCount: 0,
    parts: [{ text: "do not read this" }]
  } });
  assert.deepEqual(result.observation, {
    schemaVersion: 1, messageCount: 1, userMessageCount: 1, assistantMessageCount: 0,
    toolCallCount: 0, toolResultCount: 0, attachmentCount: 1
  });
  assert.equal(JSON.stringify(result).includes("do not read this"), false);
});

test("generic guest ABI returns a direct string or a bounded primitive WIT error", () => {
  const request = JSON.stringify({ kind: "messageMiddleware", contributionId: "conversation-insights", configuration: {}, input: {
    schemaVersion: 1, operation: "completed", completion: { actualUsage: { inputTokens: 3 } }
  } });
  assert.equal(typeof guest.invoke(request), "string");
  assert.throws(() => guest.invoke("not-json"), (error) => error === "guest_envelope_invalid");
  const invalidOperation = JSON.stringify({ kind: "messageMiddleware", contributionId: "conversation-insights", configuration: {}, input: {
    schemaVersion: 1, operation: "unsupported"
  } });
  assert.throws(() => guest.invoke(invalidOperation), (error) => error === "operation_unsupported");
});
