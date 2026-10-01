export const CONTRIBUTION_ID = 'inspect';
export interface SearchItem { readonly path: string; readonly bytes: number; }
export interface SearchResult { readonly items: readonly SearchItem[]; readonly truncated: boolean; }
export interface WorkspaceReader { search(handle: string, query: string, limit: number): string; }
export interface HostEnvelope {
  readonly kind: 'tool';
  readonly contributionId: string;
  readonly input: { readonly maxFiles?: number };
  readonly context?: { readonly resourceHandles?: Readonly<Record<string, string>> };
}
export interface WorkspaceHealthResult {
  readonly sampledFiles: number;
  readonly sampledBytes: number;
  readonly truncated: boolean;
  readonly completeProjectTotals: { readonly fileCount: number; readonly bytes: number } | null;
  readonly sampledExtensions: Readonly<Record<string, number>>;
  readonly largestFiles: readonly SearchItem[];
}

export function handleWorkspaceHealth(envelope: HostEnvelope, workspace: WorkspaceReader): WorkspaceHealthResult {
  if (envelope.kind !== 'tool' || envelope.contributionId !== CONTRIBUTION_ID) throw new Error('contribution_mismatch');
  const handle = envelope.context?.resourceHandles?.workspace;
  if (typeof handle !== 'string' || handle.length === 0) throw new Error('workspace_handle_missing');
  const limit = envelope.input?.maxFiles ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('max_files_out_of_range');
  const raw = workspace.search(handle, '', limit);
  let parsed: SearchResult;
  try { parsed = JSON.parse(raw) as SearchResult; } catch { throw new Error('workspace_search_result_invalid'); }
  if (!parsed || !Array.isArray(parsed.items) || typeof parsed.truncated !== 'boolean') throw new Error('workspace_search_result_invalid');
  const items = parsed.items.map(validateItem).sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const sampledBytes = items.reduce((total, item) => total + item.bytes, 0);
  const sampledExtensions: Record<string, number> = {};
  for (const item of items) {
    const filename = item.path.slice(item.path.lastIndexOf('/') + 1);
    const dot = filename.lastIndexOf('.');
    const extension = dot <= 0 ? '[none]' : filename.slice(dot).toLowerCase();
    sampledExtensions[extension] = (sampledExtensions[extension] ?? 0) + 1;
  }
  const largestFiles = [...items].sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path, 'en')).slice(0, 10);
  return {
    sampledFiles: items.length,
    sampledBytes,
    truncated: parsed.truncated,
    completeProjectTotals: parsed.truncated ? null : { fileCount: items.length, bytes: sampledBytes },
    sampledExtensions: Object.fromEntries(Object.entries(sampledExtensions).sort(([left], [right]) => left.localeCompare(right, 'en'))),
    largestFiles,
  };
}

function validateItem(item: SearchItem): SearchItem {
  if (!item || typeof item.path !== 'string' || item.path.length === 0 || item.path.startsWith('/') || item.path.includes('\\')
    || item.path.startsWith('./') || item.path.includes(':')
    || item.path.split('/').some((segment) => segment === '..' || segment === '.' || segment.length === 0)
    || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error('workspace_search_item_invalid');
  return { path: item.path, bytes: item.bytes };
}
