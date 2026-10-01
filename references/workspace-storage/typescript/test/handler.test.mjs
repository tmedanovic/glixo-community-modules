import assert from 'node:assert/strict';
import test from 'node:test';
import { handleStorage, TEST_PREFIX } from '../dist/js/handler.js';

class MemoryState {
  values = new Map();
  get(key) { return this.values.get(key); }
  set(key, value) { this.values.set(key, value); }
  list(prefix) { return [...this.values.keys()].filter((key) => key.startsWith(prefix)); }
  delete(key) { return this.values.delete(key); }
}

const request = (operation, input) => ({ kind: 'tool', contributionId: 'storage', input: { operation, ...input } });

test('storage operations stay in the declared test namespace and return only logical keys', () => {
  const state = new MemoryState();
  assert.deepEqual(handleStorage(request('set', { key: 'sample-1', value: 'green' }), state), { operation: 'set', key: 'sample-1', stored: true });
  assert.equal(state.values.get(`${TEST_PREFIX}sample-1`), 'green');
  assert.deepEqual(handleStorage(request('get', { key: 'sample-1' }), state), { operation: 'get', key: 'sample-1', value: 'green' });
  assert.deepEqual(handleStorage(request('list', { prefix: '' }), state), { operation: 'list', prefix: '', keys: ['sample-1'] });
  assert.deepEqual(handleStorage(request('delete', { key: 'sample-1' }), state), { operation: 'delete', key: 'sample-1', deleted: true });
  assert.deepEqual(handleStorage(request('get', { key: 'sample-1' }), state), { operation: 'get', key: 'sample-1', value: null });
});

test('guest input cannot escape the test namespace or write an unbounded value', () => {
  const state = new MemoryState();
  for (const key of ['../outside', 'nested/key', '', '.', '..']) {
    assert.throws(() => handleStorage(request('get', { key }), state), /storage_key_invalid/);
  }
  assert.throws(() => handleStorage(request('set', { key: 'large', value: 'x'.repeat(4097) }), state), /value_too_large/);
  assert.equal(state.values.size, 0);
});

test('listing is sorted, prefix-bounded, and ignores keys outside the reference namespace', () => {
  const state = new MemoryState();
  state.set(`${TEST_PREFIX}zeta`, '1');
  state.set(`${TEST_PREFIX}alpha`, '2');
  state.set('other-package/test/hidden', '3');
  assert.deepEqual(handleStorage(request('list', { prefix: 'a' }), state), { operation: 'list', prefix: 'a', keys: ['alpha'] });
});
