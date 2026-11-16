type JsonObject = Record<string, unknown>;
type Envelope = { kind: string; contributionId: string; configuration: unknown; input: unknown };

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}
function count(source: JsonObject | undefined, key: string): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function nullableCount(source: JsonObject | undefined, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// docs:snippet-start conversation-insights-handler:typescript
export function analyze(inputValue: unknown): JsonObject {
  const input = object(inputValue);
  if (input?.schemaVersion !== 1) throw new Error("middleware_schema_unsupported");
  if (input.operation === "committed") {
    const message = object(input.committedMessage);
    if (!message) throw new Error("committed_message_missing");
    const role = message.role;
    return {
      observation: {
        schemaVersion: 1,
        messageCount: 1,
        userMessageCount: role === "user" ? 1 : 0,
        assistantMessageCount: role === "assistant" ? 1 : 0,
        toolCallCount: count(message, "toolCallCount"),
        toolResultCount: count(message, "toolResultCount"),
        attachmentCount: count(message, "attachmentCount")
      },
      auditDescription: "insights-recorded"
    };
  }
  if (input.operation === "completed") {
    const completion = object(input.completion);
    if (!completion) throw new Error("completion_missing");
    const usage = object(completion.actualUsage);
    const actualUsage = usage ? {
      inputTokens: nullableCount(usage, "inputTokens"),
      outputTokens: nullableCount(usage, "outputTokens"),
      cachedTokens: nullableCount(usage, "cachedTokens"),
      reasoningTokens: nullableCount(usage, "reasoningTokens"),
      totalTokens: nullableCount(usage, "totalTokens")
    } : null;
    return {
      observation: {
        schemaVersion: 1,
        latencyMilliseconds: count(completion, "latencyMilliseconds"),
        userMessageCount: count(completion, "userMessageCount"),
        assistantMessageCount: count(completion, "assistantMessageCount"),
        toolCallCount: count(completion, "toolCallCount"),
        toolResultCount: count(completion, "toolResultCount"),
        attachmentCount: count(completion, "attachmentCount"),
        actualUsageAvailable: usage !== undefined,
        actualUsage,
        estimatedInputCharacters: count(completion, "estimatedInputCharacters"),
        estimatedOutputCharacters: count(completion, "estimatedOutputCharacters"),
        textStatisticsAreEstimates: true
      },
      auditDescription: "analysis-complete"
    };
  }
  throw new Error("operation_unsupported");
}
// docs:snippet-end conversation-insights-handler:typescript

function guestErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /^[a-z][a-z0-9_]{2,80}$/.test(message) ? message.slice(0, 240) : fallback;
}

export const guest = {
  invoke(requestJson: string): string {
    let parsed: unknown;
    try { parsed = JSON.parse(requestJson); }
    catch { throw "guest_envelope_invalid"; }
    const envelope = object(parsed);
    if (!envelope || envelope.kind !== "messageMiddleware" || envelope.contributionId !== "conversation-insights") {
      throw "guest_envelope_invalid";
    }
    try { return JSON.stringify(analyze(envelope.input)); }
    catch (error) { throw guestErrorCode(error, "middleware_invocation_failed"); }
  }
};
