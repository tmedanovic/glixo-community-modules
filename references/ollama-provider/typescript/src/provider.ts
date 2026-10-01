import {
  httpStart, httpStatus, httpResponseHeaders, httpRead, httpCancel, httpDrop,
} from "glixo:http/broker@3.0.0";
import {
  log,
} from "glixo:llm-provider-compat/provider-host@3.0.0";
import { NdjsonStream, type Broker, type BrokerRequest, type Header } from "@glixo/extension-sdk/http";
import { throwWitError, witErrorText } from "@glixo/extension-sdk/wit";

type Maybe<T> = T | undefined;
type Endpoint = { name: string; handle: string; baseUrl: string };
type Context = { configurationJson: string; endpoints: Endpoint[] };
type Part = { tag: string; val?: unknown };
type Message = { role: string; parts: Part[] };
type Tool = { name: string; description: string; schemaJson: string };
type Request = {
  requestId: string; model: string; messages: Message[]; tools: Tool[];
  responseFormat: Maybe<{ kind: string; schemaJson: Maybe<string> }>;
  sampling: Maybe<{ temperature: Maybe<number>; topP: Maybe<number>; maxOutputTokens: Maybe<number> }>;
  extensionsJson: Maybe<string>;
};
type OllamaRecord = {
  model?: string;
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};
type PendingEvent = { event: Record<string, unknown>; terminal: boolean };
type Session = { stream: NdjsonStream; requestId: string; model: string; terminalSent: boolean; cancelled: boolean; toolIndex: number; pending: PendingEvent[] };

const providerId = "community.ollama";
const streamSessions = new Map<number, Session>();
let nextHandle = 1;

class ImportedBroker implements Broker {
  httpStart(request: BrokerRequest): BrokerResult<number> { return importResult(() => httpStart(request)); }
  httpStatus(handle: number): BrokerResult<number> { return importResult(() => httpStatus(handle)); }
  httpResponseHeaders(handle: number): BrokerResult<readonly Header[]> { return importResult(() => httpResponseHeaders(handle)); }
  httpRead(handle: number, maxBytes: number): BrokerResult<Uint8Array | undefined> { return importResult(() => httpRead(handle, maxBytes)); }
  httpCancel(handle: number): void { httpCancel(handle); }
  httpDrop(handle: number): void { httpDrop(handle); }
}
type BrokerResult<T> = { ok: true; value: T } | { ok: false; error: string };
function importResult<T>(operation: () => T): BrokerResult<T> {
  try { return { ok: true, value: operation() }; }
  catch (error) { return { ok: false, error: witErrorText(error) }; }
}
const broker = new ImportedBroker();
const none: undefined = undefined;
const some = <T>(value: T): Maybe<T> => value;
const isSome = <T>(value: Maybe<T>): value is T => value !== undefined;

function config(context: Context): { endpointName: string; model?: string } {
  let value: unknown;
  try { value = JSON.parse(context.configurationJson); }
  catch { throw new Error("configuration_json_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("configuration_object_required");
  const obj = value as Record<string, unknown>;
  const endpointName = obj.endpointName;
  const model = obj.model;
  if (endpointName !== "ollama") throw new Error("endpointName_must_be_ollama");
  if (model !== undefined && (typeof model !== "string" || !model.trim())) throw new Error("model_must_be_nonempty_string");
  return { endpointName, ...(typeof model === "string" ? { model } : {}) };
}
function endpoint(context: Context): Endpoint {
  const cfg = config(context);
  const grant = context.endpoints.find((candidate) => candidate.name === cfg.endpointName);
  if (!grant || !grant.handle) throw new Error("approved_ollama_endpoint_missing");
  if (!/^https?:\/\/[^/?#]+\/?$/.test(grant.baseUrl)) throw new Error("approved_ollama_base_url_invalid");
  return { ...grant, baseUrl: grant.baseUrl.replace(/\/$/, "") };
}
function requestFor(ep: Endpoint, path: string, method: "GET" | "POST", body?: unknown): BrokerRequest {
  if (!path.startsWith("/api/") || path.includes("..") || path.includes("?") || path.includes("#")) throw new Error("ollama_path_invalid");
  const json = body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body));
  return {
    url: `${ep.baseUrl}${path}`, method, headers: [{ name: "accept", value: "application/json" }],
    ...(json ? { body: json, contentType: "application/json" } : {}),
    timeoutMs: 30_000, maxResponseBytes: 8 * 1024 * 1024,
    acceptedStatusMin: 200, acceptedStatusMax: 299, endpointHandle: ep.handle,
  };
}
function readBounded(ep: Endpoint, path: string, method: "GET" | "POST", body?: unknown): unknown {
  const stream = new NdjsonStream(broker, requestFor(ep, path, method, body), 1024 * 1024);
  try {
    const status = stream.status();
    if (status < 200 || status > 299) throw new Error(`ollama_http_${status}`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const line = stream.nextLine();
      if (line === undefined) break;
      total += line.byteLength + 1;
      if (total > 8 * 1024 * 1024) throw new Error("ollama_response_too_large");
      if (line.byteLength) chunks.push(line, new Uint8Array([10]));
    }
    const bytes = concat(...chunks);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    try { return JSON.parse(text); } catch { throw new Error("ollama_json_invalid"); }
  } finally { stream.close(); }
}
function listTags(context: Context): string[] {
  const ep = endpoint(context);
  const result = readBounded(ep, "/api/tags", "GET");
  if (!result || typeof result !== "object" || !Array.isArray((result as { models?: unknown }).models)) throw new Error("ollama_tags_invalid");
  return ((result as { models: Array<{ name?: unknown; model?: unknown }> }).models)
    .map((item) => typeof item.name === "string" ? item.name : item.model)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}
function showModel(context: Context, model: string): Set<string> {
  const result = readBounded(endpoint(context), "/api/show", "POST", { model });
  if (!result || typeof result !== "object") throw new Error("ollama_show_invalid");
  const capabilities = (result as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities)) return new Set();
  return new Set(capabilities.filter((item): item is string => typeof item === "string"));
}
function ollamaMessages(request: Request, capabilities: Set<string>): unknown[] {
  const wantsVision = request.messages.some((message) => message.parts.some((part) => part.tag === "media-ref"));
  if (wantsVision && !capabilities.has("vision")) throw new Error("model_does_not_support_vision");
  const messages = request.messages.map((message) => {
    const content: string[] = [];
    const images: string[] = [];
    for (const part of message.parts) {
      if (part.tag === "text" || part.tag === "tool-result") content.push(String(part.val ?? ""));
      else if (part.tag === "reasoning") content.push(String(part.val ?? ""));
      else if (part.tag === "media-ref") {
        const value = String(part.val ?? "");
        const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
        if (!match) throw new Error("vision_requires_base64_image_data_uri");
        images.push(match[1]);
      } else if (part.tag !== "annotation" && part.tag !== "citation") {
        throw new Error(`unsupported_message_part_${part.tag}`);
      }
    }
    return { role: message.role, content: content.join(""), ...(images.length ? { images } : {}) };
  });
  return messages;
}
function buildChat(request: Request, caps: Set<string>): Record<string, unknown> {
  if (!request.model) throw new Error("model_required");
  if (request.tools.length && !caps.has("tools")) throw new Error("model_does_not_support_tools");
  const ext = isSome(request.extensionsJson) ? parseObject(request.extensionsJson, "extensions_json_invalid") : {};
  if (ext.think === true && !caps.has("thinking")) throw new Error("model_does_not_support_thinking");
  const body: Record<string, unknown> = {
    model: request.model, messages: ollamaMessages(request, caps), stream: true,
  };
  if (request.tools.length) body.tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: JSON.parse(tool.schemaJson) } }));
  if (isSome(request.responseFormat)) {
    const format = request.responseFormat;
    if (format.kind === "json") body.format = isSome(format.schemaJson) ? JSON.parse(format.schemaJson) : "json";
    else if (format.kind !== "text") throw new Error("response_format_unsupported");
  }
  if (isSome(request.sampling)) {
    const options: Record<string, unknown> = {};
    if (isSome(request.sampling.temperature)) options.temperature = request.sampling.temperature;
    if (isSome(request.sampling.topP)) options.top_p = request.sampling.topP;
    if (isSome(request.sampling.maxOutputTokens)) options.num_predict = request.sampling.maxOutputTokens;
    if (Object.keys(options).length) body.options = options;
  }
  if (ext.think === true) body.think = true;
  return body;
}
function parseObject(json: string, code: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* use stable diagnostic below */ }
  throw new Error(code);
}
function terminalReason(reason: string | undefined, hasTools: boolean): Part {
  if (hasTools || reason === "tool_calls" || reason === "tool") return { tag: "tool" };
  if (reason === "length") return { tag: "length" };
  if (reason === "stop" || !reason) return { tag: "stop" };
  return { tag: "unknown", val: { name: reason, payloadJson: none } };
}
function event(requestId: string, init: Record<string, unknown>): Record<string, unknown> {
  return { requestId, part: none, usage: none, finish: none, warning: none, error: none, providerRequestId: none, providerResponseId: none, ...init };
}
function asOption<T>(value: T | undefined): Maybe<T> { return value === undefined ? none : some(value); }
function concat(...chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
function parseRecord(line: Uint8Array): OllamaRecord {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)) as OllamaRecord; }
  catch { throw new Error("ollama_ndjson_record_invalid"); }
}

// docs:snippet-start provider-discovery:typescript
function listModels(context: Context): string[] {
  try { return listTags(context); }
  catch (error) { throwWitError(error); }
}
// docs:snippet-end provider-discovery:typescript

// docs:snippet-start provider-request:typescript
function start(request: Request, context: Context): number {
  let stream: NdjsonStream | undefined;
  try {
    const caps = showModel(context, request.model);
    const body = buildChat(request, caps);
    stream = new NdjsonStream(broker, requestFor(endpoint(context), "/api/chat", "POST", body), 1024 * 1024);
    const status = stream.status();
    if (status < 200 || status > 299) throw new Error(`ollama_http_${status}`);
    const id = nextHandle++;
    streamSessions.set(id, { stream, requestId: request.requestId, model: request.model, terminalSent: false, cancelled: false, toolIndex: 0, pending: [] });
    return id;
  } catch (error) { stream?.close(); throwWitError(error); }
}
// docs:snippet-end provider-request:typescript

function deliver(session: Session, pending: PendingEvent): Record<string, unknown> {
  if (pending.terminal) { session.terminalSent = true; session.stream.close(); }
  return pending.event;
}

function next(handle: number): Maybe<Record<string, unknown>> {
  const session = streamSessions.get(handle);
  if (!session) throwWitError("provider_stream_missing");
  if (session.terminalSent) return none;
  if (session.pending.length) return deliver(session, session.pending.shift()!);
  if (session.cancelled) {
    session.terminalSent = true;
    return event(session.requestId, { finish: some({ tag: "cancelled" }) });
  }
  try {
    for (;;) {
      const line = session.stream.nextLine();
      if (line === undefined) throw new Error("ollama_stream_ended_before_done");
      if (!line.byteLength) continue;
      const record = parseRecord(line);
      if (record.error) {
        session.stream.close();
        session.terminalSent = true;
        return event(session.requestId, {
          error: some({ code: "ollama_error", message: record.error.slice(0, 256), retryable: false, retryAfterMs: none }),
          finish: some({ tag: "error" }),
        });
      }
      const produced: PendingEvent[] = [];
      const messageRecord = record.message;
      if (messageRecord?.thinking) produced.push({ event: event(session.requestId, { part: some({ tag: "reasoning", val: messageRecord.thinking }) }), terminal: false });
      if (messageRecord?.content) produced.push({ event: event(session.requestId, { part: some({ tag: "text", val: messageRecord.content }) }), terminal: false });
      const calls = messageRecord?.tool_calls ?? [];
      if (calls.length > 32) throw new Error("ollama_tool_call_limit_exceeded");
      for (const call of calls) {
        const fn = call?.function;
        if (!fn?.name) continue;
        const payload = JSON.stringify(fn.arguments ?? {});
        const id = `${session.requestId}:ollama:${session.toolIndex++}`;
        produced.push({ event: event(session.requestId, { part: some({ tag: "tool-call-details", val: { id, name: fn.name, argumentsFragment: some(payload), complete: true } }) }), terminal: false });
      }
      if (record.done) {
        const usage = record.prompt_eval_count === undefined && record.eval_count === undefined ? none : some({
          inputTokens: boundedCount(record.prompt_eval_count), outputTokens: boundedCount(record.eval_count),
          cachedTokens: none, reasoningTokens: none,
          totalTokens: record.prompt_eval_count === undefined || record.eval_count === undefined ? none : some(boundedCount(record.prompt_eval_count + record.eval_count)),
        });
        produced.push({ event: event(session.requestId, { usage, finish: some(terminalReason(record.done_reason, calls.length > 0)) }), terminal: true });
      }
      if (!produced.length) continue;
      session.pending.push(...produced.slice(1));
      return deliver(session, produced[0]);
    }
  } catch (error) {
    session.terminalSent = true;
    session.stream.close();
    return event(session.requestId, {
      error: some({ code: "ollama_stream_error", message: message(error), retryable: false, retryAfterMs: none }),
      finish: some({ tag: "error" }),
    });
  }
}
function boundedCount(value: number | undefined): number { return Math.max(0, Math.min(0xffff_ffff, Number.isFinite(value) ? Math.trunc(value ?? 0) : 0)); }
function message(error: unknown): string { return witErrorText(error); }

export const provider = {
  describe(context: Context): Record<string, unknown> {
    try {
      const models = listTags(context);
      const cfg = config(context);
      const selected = cfg.model ? models.filter((name) => name === cfg.model) : models.slice(0, 64);
      const aggregate = new Set<string>();
      for (const model of selected) for (const cap of showModel(context, model)) aggregate.add(cap);
      const capabilities = [{ name: "chat", optional: false }, { name: "streaming", optional: false }];
      for (const [ollama, publicName] of [["tools", "tools"], ["vision", "images"], ["thinking", "reasoning"]]) {
        if (aggregate.has(ollama)) capabilities.push({ name: publicName, optional: true });
      }
      return { id: providerId, name: "Ollama", version: "0.1.0", models, capabilities };
    } catch (error) { throwWitError(error); }
  },
  validateConfiguration(configJson: string, context: Context): Record<string, unknown> {
    const diagnostics: string[] = [];
    try {
      const parsed = config({ ...context, configurationJson: configJson });
      endpoint({ ...context, configurationJson: configJson });
      if (parsed.model) {
        const available = listTags({ ...context, configurationJson: configJson });
        if (!available.includes(parsed.model)) diagnostics.push("configured model is not present in /api/tags");
      }
    } catch (error) { diagnostics.push(message(error)); }
    return { valid: diagnostics.length === 0, diagnostics };
  },
  listModels,
  start,
  next,
  cancel(handle: number): void {
    const session = streamSessions.get(handle);
    if (!session || session.terminalSent) return;
    session.stream.cancel(); session.cancelled = true;
  },
  drop(handle: number): void {
    const session = streamSessions.get(handle);
    if (!session) return;
    session.stream.close(); streamSessions.delete(handle);
  },
};

function unusedLog(messageText: string): void { log("debug", messageText); }





