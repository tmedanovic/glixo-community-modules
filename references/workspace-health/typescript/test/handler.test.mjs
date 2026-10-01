import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWorkspaceHealth } from '../dist/js/handler.js';

const request = (input = {}, resourceHandles = { workspace: 'host-issued' }) => ({
  kind: 'tool', contributionId: 'inspect', input, context: { resourceHandles },
});

test('workspace health sorts a bounded sample and does not claim complete totals when truncated', () => {
  let received;
  const workspace = { search(handle, query, limit) {
    received = { handle, query, limit };
    return JSON.stringify({ items: [
      { path: 'zeta.md', bytes: 80 },
      { path: 'src/main.cs', bytes: 240 },
    ], truncated: true });
  } };
  const result = handleWorkspaceHealth(request({ maxFiles: 2 }), workspace);
  assert.deepEqual(received, { handle: 'host-issued', query: '', limit: 2 });
  assert.equal(result.sampledFiles, 2);
  assert.equal(result.sampledBytes, 320);
  assert.equal(result.truncated, true);
  assert.equal(result.completeProjectTotals, null);
  assert.deepEqual(result.sampledExtensions, { '.cs': 1, '.md': 1 });
  assert.deepEqual(result.largestFiles.map((item) => item.path), ['src/main.cs', 'zeta.md']);
});

test('complete listings may report project totals and stable largest-file order', () => {
  const workspace = { search: () => JSON.stringify({ items: [
    { path: 'b.txt', bytes: 5 }, { path: 'a.txt', bytes: 5 },
  ], truncated: false }) };
  const result = handleWorkspaceHealth(request(), workspace);
  assert.deepEqual(result.completeProjectTotals, { fileCount: 2, bytes: 10 });
  assert.deepEqual(result.largestFiles.map((item) => item.path), ['a.txt', 'b.txt']);
});

test('missing host handle, unreasonable limit, malformed paths, and malformed broker output fail closed', () => {
  const valid = { search: () => JSON.stringify({ items: [], truncated: false }) };
  assert.throws(() => handleWorkspaceHealth(request({}, {}), valid), /workspace_handle_missing/);
  assert.throws(() => handleWorkspaceHealth(request({ maxFiles: 101 }), valid), /max_files_out_of_range/);
  assert.throws(() => handleWorkspaceHealth(request(), { search: () => '{' }), /workspace_search_result_invalid/);
  assert.throws(() => handleWorkspaceHealth(request(), { search: () => JSON.stringify({ items: [{ path: '../outside', bytes: 1 }], truncated: false }) }), /workspace_search_item_invalid/);
});
