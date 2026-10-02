import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSavePreferences, STORAGE_KEY } from '../dist/js/handler.js';

class MemoryState {
  values = new Map();
  set(key, value) { this.values.set(key, value); }
}

const request = (input) => ({
  kind: 'actions', contributionId: 'save-preferences', configuration: {}, input,
  context: { sessionId: 'contribution:save-preferences', resourceHandles: {}, endpoints: [] },
});

test('valid custom preferences are normalized and saved inside the extension prefix', () => {
  const state = new MemoryState();
  assert.deepEqual(handleSavePreferences(request({ accent: '#AABBCC', largeControls: true }), state), { accepted: true });
  assert.equal(state.values.get(STORAGE_KEY), '{"accent":"#aabbcc","largeControls":true}');
});

test('invalid custom values do not write state', () => {
  const state = new MemoryState();
  assert.throws(() => handleSavePreferences(request({ accent: 'url(#bad)', largeControls: true }), state), /preferences_invalid/);
  assert.equal(state.values.size, 0);
});
