import type { Broker as HttpBroker, BrokerRequest, Result } from "@glixo/extension-sdk/http";

export interface EndpointGrant {
  readonly name: string;
  readonly handle: string;
  readonly baseUrl: string;
}

export interface HostEnvelope {
  readonly kind: string;
  readonly contributionId: string;
  readonly configuration: unknown;
  readonly input: unknown;
  readonly context: { readonly endpoints: readonly EndpointGrant[] };
}

const MAX_RESPONSE_BYTES = 128 * 1024;
const READ_BYTES = 16 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function unwrap<T>(result: Result<T>, code: string): T {
  if (result.ok) return result.value;
  throw new Error(code);
}

function parseIssueKey(input: unknown): string {
  const value = object(input)?.issueKey;
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}(?![\s\S])/.test(value)) {
    throw new Error("issue_key_invalid");
  }
  return value;
}

function resolveEndpoint(envelope: HostEnvelope): EndpointGrant {
  const config = object(envelope.configuration);
  if (config?.endpointName !== "issues") throw new Error("endpoint_name_must_be_issues");
  const endpoint = envelope.context?.endpoints?.find((item) => item.name === "issues");
  if (!endpoint || typeof endpoint.handle !== "string" || endpoint.handle.length === 0) {
    throw new Error("approved_issues_endpoint_missing");
  }
  let base: URL;
  try { base = new URL(endpoint.baseUrl); }
  catch { throw new Error("approved_endpoint_url_invalid"); }
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.username || base.password || base.search || base.hash) {
    throw new Error("approved_endpoint_url_invalid");
  }
  // The exact endpoint name, opaque handle, and /mcp path are checked again by the host.
  base.pathname = "/mcp";
  return { ...endpoint, baseUrl: base.toString() };
}

function readBody(broker: HttpBroker, handle: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let emptyReads = 0;
  while (true) {
    const chunk = unwrap(broker.httpRead(handle, READ_BYTES), "http_read_failed");
    if (chunk === undefined) break;
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) throw new Error("mcp_response_too_large");
    if (chunk.byteLength === 0) {
      if (++emptyReads > 32) throw new Error("mcp_response_stalled");
    } else {
      emptyReads = 0;
      chunks.push(chunk);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function parseMcpResponse(body: Uint8Array, issueKey: string): JsonObject {
  let response: unknown;
  try { response = JSON.parse(decoder.decode(body)); }
  catch { throw new Error("mcp_response_invalid_json"); }
  const rpc = object(response);
  if (rpc?.jsonrpc !== "2.0" || rpc.id !== 1 || Object.hasOwn(rpc, "error")) throw new Error("mcp_call_failed");
  const result = object(rpc.result);
  const content = result?.content;
  if (!Array.isArray(content)) throw new Error("mcp_result_content_missing");
  if (content.length !== 1) throw new Error("mcp_result_content_invalid");
  const textPart = object(content[0]);
  const summary = textPart?.type === "text" && typeof textPart.text === "string" ? textPart.text : undefined;
  if (summary === undefined || encoder.encode(summary).byteLength > 64 * 1024) throw new Error("mcp_result_content_invalid");
  return { issueKey, summary };
}

// docs:snippet-start issue-lookup-mcp:typescript
export function lookupIssue(envelope: HostEnvelope, broker: HttpBroker): JsonObject {
  if (envelope.kind !== "tools" || envelope.contributionId !== "issue-lookup") throw new Error("guest_envelope_invalid");
  const issueKey = parseIssueKey(envelope.input);
  const endpoint = resolveEndpoint(envelope);
  const requestBody = encoder.encode(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "issues.lookup",
      arguments: { issueKey },
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "glixo-issue-lookup", version: "0.1.0" }
      }
    }
  }));
  const request: BrokerRequest = {
    url: endpoint.baseUrl,
    method: "POST",
    headers: [
      { name: "Accept", value: "application/json" },
      { name: "MCP-Protocol-Version", value: "2026-07-28" },
      { name: "Mcp-Method", value: "tools/call" },
      { name: "Mcp-Name", value: "issues.lookup" }
    ],
    body: requestBody,
    contentType: "application/json",
    timeoutMs: 15_000,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    acceptedStatusMin: 200,
    acceptedStatusMax: 299,
    endpointHandle: endpoint.handle
  };
  const handle = unwrap<number>(broker.httpStart(request), "mcp_request_denied");
  let completed = false;
  try {
    const status = unwrap<number>(broker.httpStatus(handle), "mcp_status_failed");
    if (status !== 200) throw new Error("mcp_http_status_invalid");
    const headers = unwrap<readonly { name: string; value: string }[]>(broker.httpResponseHeaders(handle), "mcp_headers_failed");
    const contentType = headers.find((header) => header.name.toLowerCase() === "content-type")?.value;
    if (!contentType || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("mcp_content_type_invalid");
    const output = parseMcpResponse(readBody(broker, handle), issueKey);
    completed = true;
    return output;
  } finally {
    if (!completed) broker.httpCancel(handle);
    broker.httpDrop(handle);
  }
}
// docs:snippet-end issue-lookup-mcp:typescript
