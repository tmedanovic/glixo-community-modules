import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDocumentIndex } from '../dist/js/handler.js';

function broker(items, contents, truncated = false) {
  const calls = [];
  return {
    calls,
    search(handle, query, limit) { calls.push(['search', handle, query, limit]); return JSON.stringify({ items, truncated }); },
    read(handle, path, maxBytes) { calls.push(['read', handle, path, maxBytes]); return contents[path]; },
  };
}

test('searches paths, sorts host results, bounds reads, and cuts excerpts on UTF-8 boundaries', () => {
  const b = broker([{ path: 'z/é.txt', bytes: 5 }, { path: 'a/readme.md', bytes: 12 }], { 'z/é.txt': 'ok', 'a/readme.md': '😀abc' }, true);
  const result = handleDocumentIndex({ kind: 'dataSources', contributionId: 'search', input: { query: 'read', excerptBytes: 3 }, context: { resourceHandles: { workspace: 'opaque-1' } } }, b);
  assert.deepEqual(result.items.map((item) => item.path), ['a/readme.md', 'z/é.txt']);
  assert.deepEqual(result.items[0], { path: 'a/readme.md', bytes: 12, excerpt: '', excerptTruncated: true });
  assert.equal(result.truncated, true);
  assert.deepEqual(b.calls[0], ['search', 'opaque-1', 'read', 10]);
  assert.ok(b.calls.filter((call) => call[0] === 'read').every((call) => call[3] === 4096));
});

test('does not read an item reported above the per-file broker cap', () => {
  const b = broker([{ path: 'big.txt', bytes: 9000 }], {});
  const result = handleDocumentIndex({ kind: 'dataSources', contributionId: 'search', input: { query: 'big' }, context: { resourceHandles: { workspace: 'opaque-2' } } }, b);
  assert.deepEqual(result.items[0], { path: 'big.txt', bytes: 9000, excerpt: null, excerptTruncated: true });
  assert.equal(b.calls.some((call) => call[0] === 'read'), false);
});

test('fails closed for missing handle, invalid query, and unsafe broker paths', () => {
  assert.throws(() => handleDocumentIndex({ kind: 'dataSources', contributionId: 'search', input: { query: 'x' } }, broker([], {})), /workspace_handle_missing/);
  assert.throws(() => handleDocumentIndex({ kind: 'dataSources', contributionId: 'search', input: { query: '  ' }, context: { resourceHandles: { workspace: 'h' } } }, broker([], {})), /query_invalid/);
  assert.throws(() => handleDocumentIndex({ kind: 'dataSources', contributionId: 'search', input: { query: 'x' }, context: { resourceHandles: { workspace: 'h' } } }, broker([{ path: '../secret', bytes: 1 }], {})), /workspace_search_item_invalid/);
});
