import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { handleWorkflowTextStats } from '../dist/js/handler.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePaths = [
  resolve(projectRoot, '../../_shared/goldens/workflow-text-stats/cases.json'),
  resolve(projectRoot, 'shared/goldens/workflow-text-stats/cases.json'),
];
const fixturePath = fixturePaths.find((path) => { try { readFileSync(path); return true; } catch { return false; } });
if (!fixturePath) throw new Error('shared workflow-text-stats cases.json was not found');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('shared Unicode and minimum-length cases match', () => {
  for (const item of fixture.cases) {
    assert.deepEqual(handleWorkflowTextStats(JSON.stringify(item.request)), item.expectedResponse, item.id);
  }
});

test('rejects bad options and oversized text', () => {
  const request = (input) => JSON.stringify({ kind: 'tools', contributionId: 'text-stats', configuration: {}, input, context: { sessionId: 's', resourceHandles: {}, endpoints: [] } });
  assert.throws(() => handleWorkflowTextStats(request({ text: 'x', minimumWordLength: 0 })), (error) => error === 'minimum_word_length_out_of_range');
  assert.throws(() => handleWorkflowTextStats(request({ text: 'x'.repeat(65_537) })), (error) => error === 'text_too_long');
});
