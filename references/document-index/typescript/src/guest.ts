import { workspaceRead, workspaceSearch } from 'glixo:contribution/broker@1.0.0';
import { handleDocumentIndex, type HostEnvelope, type WorkspaceReader } from './handler.js';

const workspace: WorkspaceReader = {
  search(handle, query, limit) { return workspaceSearch(handle, query, limit); },
  read(handle, path, maxBytes) { return workspaceRead(handle, path, maxBytes); },
};

export const guest = {
  invoke(requestJson: string): string {
    try {
      const response = handleDocumentIndex(JSON.parse(requestJson) as HostEnvelope, workspace);
      return JSON.stringify(response);
    } catch (error) {
      throw errorPayload(error, 'document_index_failed');
    }
  },
};

function errorPayload(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  return message.slice(0, 240) || fallback;
}
