import type { Broker, BrokerRequest } from '@glixo/extension-sdk/http';
import type { ScopedState } from '@glixo/extension-sdk/state';

export const REFERENCE_ID = 'mail-watch';
export const CONTRIBUTION_ID = 'mail-watch';
export const EVENT_TYPE = 'mail.received';
const GRAPH_HOST = 'graph.microsoft.com';
const GRAPH_PATH = '/v1.0/me/mailFolders/inbox/messages/delta';
const INITIAL_DELTA_URL = `https://${GRAPH_HOST}${GRAPH_PATH}?$select=id,receivedDateTime,from&$top=10`;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGES_PER_WAKE = 5;
const SECRET_HANDLE_NAME = 'oauth';

export interface MailCheckpoint {
  readonly initialized?: boolean;
  readonly initializing?: boolean;
  readonly deltaUrl?: string;
  readonly pendingUrl?: string;
}

export interface MailServiceRequest {
  readonly kind: 'backgroundServices';
  readonly contributionId: string;
  readonly configuration?: { readonly maxPagesPerWake?: number };
  readonly input: {
    readonly operation: 'initialize' | 'wake' | 'health' | 'stop';
    readonly checkpoint?: MailCheckpoint | null;
  };
  readonly context?: { readonly resourceHandles?: Readonly<Record<string, string>> };
}

export interface MailEvent {
  readonly type: typeof EVENT_TYPE;
  readonly idempotencyKey: string;
  readonly payload: { readonly messageId: string; readonly receivedAt: string; readonly sender?: string };
}

export interface MailServiceResult {
  readonly checkpoint: MailCheckpoint;
  readonly events: readonly MailEvent[];
  readonly health: 'healthy';
}

/**
 * docs:snippet-start mail-watch-handler:typescript
 * One bounded guest call reads Graph's Inbox delta endpoint through the host broker.
 * It never requests body content, sends mail, follows a guest-selected host, or starts a loop.
 */
export function handleMailWatch(
  request: MailServiceRequest,
  broker: Broker,
  _state: ScopedState,
): MailServiceResult {
  if (request.kind !== 'backgroundServices' || request.contributionId !== CONTRIBUTION_ID) {
    throw new Error('contribution_mismatch');
  }
  const operation = request.input?.operation;
  if (!['initialize', 'wake', 'health', 'stop'].includes(operation)) throw new Error('service_operation_invalid');
  const previous = request.input.checkpoint ?? {};
  if (operation === 'health' || operation === 'stop') return { checkpoint: previous, events: [], health: 'healthy' };

  const oauthHandle = request.context?.resourceHandles?.[SECRET_HANDLE_NAME];
  if (typeof oauthHandle !== 'string' || oauthHandle.length === 0) throw new Error('graph_oauth_lease_missing');

  let initializing = operation === 'initialize' || previous.initializing === true || previous.initialized !== true;
  let cursor = previous.pendingUrl ?? previous.deltaUrl ?? INITIAL_DELTA_URL;
  let pendingUrl: string | undefined;
  let deltaUrl = previous.deltaUrl;
  const events: MailEvent[] = [];
  const configuredPages = request.configuration?.maxPagesPerWake ?? MAX_PAGES_PER_WAKE;
  if (!Number.isInteger(configuredPages) || configuredPages < 1 || configuredPages > MAX_PAGES_PER_WAKE) {
    throw new Error('mail_watch_page_limit_invalid');
  }

  for (let page = 0; page < configuredPages; page++) {
    const graphUrl = validateGraphDeltaUrl(cursor);
    const document = readGraphJson(broker, {
      url: graphUrl,
      method: 'GET',
      headers: [{ name: 'Accept', value: 'application/json' }],
      secretHandle: SECRET_HANDLE_NAME,
      authHeader: 'Authorization',
      authScheme: 'Bearer',
      timeoutMs: 5000,
      maxResponseBytes: MAX_PAGE_BYTES,
      acceptedStatusMin: 200,
      acceptedStatusMax: 299,
    });
    if (!Array.isArray(document.value)) throw new Error('graph_delta_value_invalid');
    if (!initializing) {
      for (const item of document.value) {
        if (isRecord(item) && !('@removed' in item)) {
          const event = toMailEvent(item);
          if (event) events.push(event);
        }
      }
    }

    const next = document['@odata.nextLink'];
    if (typeof next === 'string') {
      cursor = validateGraphDeltaUrl(next);
      pendingUrl = next;
      continue;
    }
    const finalDelta = document['@odata.deltaLink'];
    if (typeof finalDelta !== 'string') throw new Error('graph_delta_link_missing');
    deltaUrl = validateGraphDeltaUrl(finalDelta);
    pendingUrl = undefined;
    initializing = false;
    break;
  }

  if (pendingUrl === undefined && initializing) throw new Error('graph_initial_sync_incomplete');
  return {
    checkpoint: {
      initialized: !initializing,
      initializing,
      ...(deltaUrl ? { deltaUrl } : {}),
      ...(pendingUrl ? { pendingUrl } : {}),
    },
    events,
    health: 'healthy',
  };
}
/** docs:snippet-end mail-watch-handler:typescript */

export function validateGraphDeltaUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('graph_delta_url_invalid'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== GRAPH_HOST
    || (url.port !== '' && url.port !== '443') || url.username !== '' || url.password !== ''
    || url.hash !== '' || url.pathname.toLowerCase() !== GRAPH_PATH.toLowerCase()) {
    throw new Error('graph_delta_url_outside_scope');
  }
  return value;
}

function readGraphJson(broker: Broker, request: BrokerRequest): Record<string, unknown> {
  const started = broker.httpStart(request);
  if (!started.ok) throw new Error(started.error);
  const handle = started.value;
  let complete = false;
  try {
    const status = broker.httpStatus(handle);
    if (!status.ok) throw new Error(status.error);
    if (status.value < 200 || status.value > 299) throw new Error('graph_http_status_rejected');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = broker.httpRead(handle, 16 * 1024);
      if (!chunk.ok) throw new Error(chunk.error);
      if (chunk.value === undefined) break;
      total += chunk.value.byteLength;
      if (total > MAX_PAGE_BYTES) throw new Error('graph_response_too_large');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isRecord(parsed)) throw new Error('graph_response_invalid');
    complete = true;
    return parsed;
  } finally {
    if (!complete) broker.httpCancel(handle);
    broker.httpDrop(handle);
  }
}

function toMailEvent(message: Record<string, unknown>): MailEvent | undefined {
  if (typeof message.id !== 'string' || message.id.length === 0
    || typeof message.receivedDateTime !== 'string' || message.receivedDateTime.length === 0) return undefined;
  const from = isRecord(message.from) && isRecord(message.from.emailAddress) ? message.from.emailAddress : undefined;
  const sender = from && typeof from.address === 'string' ? from.address.slice(0, 320) : undefined;
  return {
    type: EVENT_TYPE,
    payload: { messageId: message.id, receivedAt: message.receivedDateTime, ...(sender ? { sender } : {}) },
    idempotencyKey: `mail:${stableId(message.id)}`,
  };
}

function stableId(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
