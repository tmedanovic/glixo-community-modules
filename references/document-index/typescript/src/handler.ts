export const CONTRIBUTION_ID = 'search';
const maxReadBytes = 4096;
const maxExcerptBytes = 96;

export interface SearchItem { readonly path: string; readonly bytes: number; }
export interface SearchResult { readonly items: readonly SearchItem[]; readonly truncated: boolean; }
export interface WorkspaceReader {
  search(handle: string, query: string, limit: number): string;
  read(handle: string, path: string, maxBytes: number): string;
}
export interface HostEnvelope {
  readonly kind: 'dataSources';
  readonly contributionId: string;
  readonly input: { readonly query: string; readonly limit?: number; readonly excerptBytes?: number };
  readonly context?: { readonly resourceHandles?: Readonly<Record<string, string>> };
}
export interface IndexedDocument { readonly path: string; readonly bytes: number; readonly excerpt: string | null; readonly excerptTruncated: boolean; }
export interface DocumentIndexResult { readonly query: string; readonly items: readonly IndexedDocument[]; readonly truncated: boolean; }

// docs:snippet-start document-index-handler:typescript
export function handleDocumentIndex(envelope: HostEnvelope, workspace: WorkspaceReader): DocumentIndexResult {
  if (envelope.kind !== 'dataSources' || envelope.contributionId !== CONTRIBUTION_ID) throw new Error('contribution_mismatch');
  const handle = envelope.context?.resourceHandles?.workspace;
  if (typeof handle !== 'string' || handle.length === 0) throw new Error('workspace_handle_missing');
  const query = envelope.input?.query;
  const limit = envelope.input?.limit ?? 10;
  const excerptLimit = envelope.input?.excerptBytes ?? maxExcerptBytes;
  if (typeof query !== 'string' || query.trim().length === 0 || query.length > 128) throw new Error('query_invalid');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('result_limit_invalid');
  if (!Number.isInteger(excerptLimit) || excerptLimit < 1 || excerptLimit > maxExcerptBytes) throw new Error('excerpt_limit_invalid');
  const raw = workspace.search(handle, query, limit);
  let parsed: SearchResult;
  try { parsed = JSON.parse(raw) as SearchResult; } catch { throw new Error('workspace_search_result_invalid'); }
  if (!parsed || !Array.isArray(parsed.items) || typeof parsed.truncated !== 'boolean') throw new Error('workspace_search_result_invalid');
  const matches = parsed.items.map(validateItem)
    .sort((left, right) => compareUtf8(left.path, right.path))
    .slice(0, limit);
  const items = matches.map((item): IndexedDocument => {
    if (item.bytes > maxReadBytes) return { ...item, excerpt: null, excerptTruncated: true };
    const contents = workspace.read(handle, item.path, maxReadBytes);
    if (typeof contents !== 'string') throw new Error('workspace_read_result_invalid');
    const bytes = new TextEncoder().encode(contents);
    return { ...item, excerpt: utf8Prefix(contents, bytes, excerptLimit), excerptTruncated: bytes.length > excerptLimit };
  });
  return { query, items, truncated: parsed.truncated };
}
// docs:snippet-end document-index-handler:typescript

function validateItem(item: SearchItem): SearchItem {
  if (!item || typeof item.path !== 'string' || item.path.length === 0 || item.path.startsWith('/') || item.path.includes('\\')
    || item.path.split('/').some((segment) => segment === '..' || segment === '.' || segment.length === 0)
    || item.path.startsWith('./') || item.path.includes(':')
    || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error('workspace_search_item_invalid');
  return { path: item.path, bytes: item.bytes };
}

function utf8Prefix(value: string, bytes: Uint8Array, limit: number): string {
  let end = Math.min(limit, bytes.length);
  while (end > 0) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); }
    catch { end -= 1; }
  }
  return '';
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return leftBytes.length - rightBytes.length;
}
