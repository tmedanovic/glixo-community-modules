import { workspaceRead, workspaceSearch, type WResult } from 'glixo:contribution/broker@1.0.0';
import { handleDocumentIndex, type HostEnvelope, type WorkspaceReader } from './handler.js';

const workspace: WorkspaceReader = {
  search(handle, query, limit) { return unwrap(workspaceSearch(handle, query, limit)); },
  read(handle, path, maxBytes) { return unwrap(workspaceRead(handle, path, maxBytes)); },
};

export const guest = {
  invoke(requestJson: string): WResult<string> {
    try {
      const response = handleDocumentIndex(JSON.parse(requestJson) as HostEnvelope, workspace);
      return { tag: 'ok', val: JSON.stringify(response) };
    } catch (error) {
      return { tag: 'err', val: error instanceof Error ? error.message : 'document_index_failed' };
    }
  },
};

function unwrap<T>(result: WResult<T>): T {
  if (result.tag === 'err') throw new Error(result.val);
  return result.val;
}
