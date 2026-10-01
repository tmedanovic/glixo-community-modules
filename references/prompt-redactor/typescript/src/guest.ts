type JsonObject = Record<string, unknown>;
type Envelope = { kind: string; contributionId: string; configuration: unknown; input: unknown };
type Rule = { match: string; replacement: string };
type Patch = { messageId: string; partId: string; text: string };

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}
function rulesFrom(value: unknown): Rule[] {
  const source = object(value);
  const rules = source?.rules;
  if (rules === undefined) throw new Error("redaction_rules_invalid");
  if (!Array.isArray(rules) || rules.length > 64) throw new Error("redaction_rules_invalid");
  return rules.map((raw) => {
    const rule = object(raw);
    if (typeof rule?.match !== "string" || !rule.match.length || [...rule.match].length > 512
        || typeof rule.replacement !== "string" || [...rule.replacement].length > 1024) {
      throw new Error("redaction_rule_invalid");
    }
    return { match: rule.match, replacement: rule.replacement };
  });
}

// docs:snippet-start prompt-redactor-handler:typescript
export function previewText(text: string, rules: readonly Rule[]): string {
  if (rules.length > 64) throw new Error("redaction_rules_invalid");
  let result = text;
  for (const rule of rules) {
    if (!rule.match.length || [...rule.match].length > 512 || [...rule.replacement].length > 1024) throw new Error("redaction_rule_invalid");
    result = result.split(rule.match).join(rule.replacement);
  }
  return result;
}

export function redact(inputValue: unknown, configuration: unknown): JsonObject {
  const input = object(inputValue);
  if (input?.schemaVersion !== 1 || input.operation !== "before-provider") throw new Error("operation_unsupported");
  const conversation = object(input.conversation);
  const messages = conversation?.messages;
  if (!Array.isArray(messages)) throw new Error("conversation_missing");
  const rules = rulesFrom(configuration);
  const textPatches: Patch[] = [];
  for (const messageValue of messages) {
    const message = object(messageValue);
    if (!message || message.role !== "user" || message.isHostAuthority !== false || typeof message.id !== "string" || !Array.isArray(message.parts)) continue;
    for (const partValue of message.parts) {
      const part = object(partValue);
      if (!part || part.kind !== "text" || typeof part.id !== "string" || typeof part.text !== "string") continue;
      const transformed = previewText(part.text, rules);
      if (transformed !== part.text) textPatches.push({ messageId: message.id, partId: part.id, text: transformed });
    }
  }
  return { textPatches, auditDescription: textPatches.length ? "redaction-applied" : "no-change" };
}
// docs:snippet-end prompt-redactor-handler:typescript

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
    if (!envelope || envelope.kind !== "messageMiddleware" || envelope.contributionId !== "prompt-redactor") {
      throw "guest_envelope_invalid";
    }
    try { return JSON.stringify(redact(envelope.input, envelope.configuration)); }
    catch (error) { throw guestErrorCode(error, "middleware_invocation_failed"); }
  }
};
