import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'build-references.mjs');

function fixture(stepCwd = '.') {
  const root = mkdtempSync(join(tmpdir(), 'glixo-reference-recipe-'));
  const project = join(root, 'references', 'sample-reference', 'typescript');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(root, 'references', 'reference-index.json'), JSON.stringify({ references: [
    { id: 'sample-reference', kind: 'executable', status: 'preview', languages: ['typescript'] },
  ] }));
  writeFileSync(join(project, 'reference.json'), JSON.stringify({
    referenceId: 'sample-reference', language: 'typescript', build: { recipeId: 'contribution-typescript-v1' },
  }));
  const output = 'dist/glixo-extension.component.wasm';
  const create = "require('node:fs').mkdirSync('dist',{recursive:true});require('node:fs').writeFileSync('dist/glixo-extension.component.wasm','component')";
  const verification = "if(require('node:fs').readFileSync('dist/glixo-extension.component.wasm','utf8')!=='component')process.exit(2)";
  mkdirSync(join(root, 'packages', 'extension-sdk'), { recursive: true });
  writeFileSync(join(root, 'packages', 'extension-sdk', 'support-matrix.json'), JSON.stringify({ recipes: {
    'contribution-typescript-v1': { language: 'typescript', build: {
      steps: [{ tool: 'node', args: ['-e', create], cwd: stepCwd, output }],
      verification: { tool: 'node', args: ['-e', verification], cwd: '.', output },
    } },
  } }));
  return root;
}

test('build runner executes only the resolved SDK recipe and checks its declared artifact', (t) => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /2 pinned SDK recipe steps completed/);
  assert.equal(existsSync(join(root, 'references', 'sample-reference', 'typescript', 'dist', 'glixo-extension.component.wasm')), false);
});

test('build runner rejects recipe working directories outside the project before spawning tools', (t) => {
  const root = fixture('../../');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cwd escapes project root/);
  assert.equal(result.stdout, '');
});

test('Go SDK source copy does not trigger automatic Go module vendoring', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glixo-reference-go-recipe-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'references', 'sample-reference', 'go');
  const sdk = join(root, 'packages', 'extension-sdk', 'go');
  mkdirSync(project, { recursive: true });
  mkdirSync(sdk, { recursive: true });
  writeFileSync(join(sdk, 'go.mod'), 'module github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go\n');
  writeFileSync(join(project, 'go.mod'), 'module example.test/reference\n\nreplace github.com/tmedanovic/glixo-community-modules/packages/extension-sdk/go => ../../../packages/extension-sdk/go\n');
  writeFileSync(join(project, 'reference.json'), JSON.stringify({
    referenceId: 'sample-reference', language: 'go', build: { recipeId: 'contribution-go-v1' },
  }));
  writeFileSync(join(root, 'references', 'reference-index.json'), JSON.stringify({ references: [
    { id: 'sample-reference', kind: 'executable', status: 'preview', languages: ['go'] },
  ] }));
  const check = "const fs=require('node:fs');const mod=fs.readFileSync('go.mod','utf8');if(fs.existsSync('vendor')||!fs.existsSync('.glixo-sdk/glixo-extension-sdk/go.mod')||!mod.includes('=> ./.glixo-sdk/glixo-extension-sdk'))process.exit(2);fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/guest.wasm','component')";
  writeFileSync(join(root, 'packages', 'extension-sdk', 'support-matrix.json'), JSON.stringify({
    languages: { go: { sdkPath: 'packages/extension-sdk/go' } },
    recipes: { 'contribution-go-v1': { language: 'go', build: {
      steps: [{ tool: 'node', args: ['-e', check], cwd: '.', output: 'dist/guest.wasm' }],
      verification: { tool: 'node', args: ['-e', "if(require('node:fs').readFileSync('dist/guest.wasm','utf8')!=='component')process.exit(2)"], cwd: '.', output: 'dist/guest.wasm' },
    } } },
  }));
  const result = spawnSync(process.execPath, [script, '--language=go'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
