import { workspaceSearch, type WResult } from 'glixo:contribution/broker@1.0.0';
import { handleWorkspaceHealth, type HostEnvelope, type WorkspaceReader } from './handler.js';

const workspace: WorkspaceReader = {
  search(handle, query, limit) { return unwrap(workspaceSearch(handle, query, limit)); },
};

export const guest = {
  invoke(requestJson: string): WResult<string> {
    try {
      const response = handleWorkspaceHealth(JSON.parse(requestJson) as HostEnvelope, workspace);
      return { tag: 'ok', val: JSON.stringify(response) };
    } catch (error) {
      return { tag: 'err', val: error instanceof Error ? error.message : 'workspace_health_failed' };
    }
  },
};

function unwrap<T>(result: WResult<T>): T {
  if (result.tag === 'err') throw new Error(result.val);
  return result.val;
}
