import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'build-references.mjs');

function fixture(stepCwd = '.', projectDeclaration) {
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
  const declaration = projectDeclaration ?? { schemaVersion: 1, components: [
    { id: 'sample-component', source: 'guest.ts', recipe: 'contribution-typescript-v1', world: 'glixo:contribution/contribution@1.0.0' },
  ] };
  writeFileSync(join(project, 'glixo.project.json'), JSON.stringify(declaration));
  for (const component of declaration.components ?? []) {
    if (typeof component.source === 'string') {
      const sourcePath = join(project, ...component.source.split('/'));
      mkdirSync(dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, 'export const guest = {};\n');
    }
  }
  const create = "const fs=require('node:fs');if(fs.existsSync('ignored-secret.txt'))process.exit(3);fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/glixo-extension.component.wasm','component')";
  const verification = "if(require('node:fs').readFileSync('dist/glixo-extension.component.wasm','utf8')!=='component')process.exit(2)";
  mkdirSync(join(root, 'packages', 'extension-sdk'), { recursive: true });
  writeFileSync(join(root, 'packages', 'extension-sdk', 'support-matrix.json'), JSON.stringify({ recipes: {
    'contribution-typescript-v1': { language: 'typescript', world: 'glixo:contribution/contribution@1.0.0', build: {
      steps: [{ tool: 'node', args: ['-e', create], cwd: stepCwd, output }],
      verification: { tool: 'node', args: ['-e', verification], cwd: '.', output },
    } },
  } }));
  return root;
}

function initializeCleanGitRepository(root) {
  const invoke = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  };
  invoke(['init', '-q']);
  invoke(['config', 'user.name', 'Reference Build Test']);
  invoke(['config', 'user.email', 'reference-build-test@example.invalid']);
  invoke(['remote', 'add', 'origin', 'https://github.com/tmedanovic/glixo-community-modules']);
  invoke(['add', '-A']);
  invoke(['commit', '-qm', 'fixture source']);
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

test('opt-in export retains only verified components and a deterministic source receipt', (t) => {
  const root = fixture();
  const exportDirectory = join(tmpdir(), `glixo-reference-export-${process.pid}-${Date.now()}`);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(exportDirectory, { recursive: true, force: true });
  });
  writeFileSync(join(root, '.gitignore'), 'references/sample-reference/typescript/ignored-secret.txt\n');
  initializeCleanGitRepository(root);
  writeFileSync(join(root, 'references', 'sample-reference', 'typescript', 'ignored-secret.txt'), 'must not enter the build input');
  mkdirSync(exportDirectory);
  const result = spawnSync(process.execPath, [script, '--language=typescript', '--export-dir', exportDirectory], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /exported 1 verified components from [0-9a-f]{40}/);
  const componentPath = join(exportDirectory, 'components', 'sample-reference', 'typescript', 'sample-component', 'glixo-extension.component.wasm');
  assert.equal(readFileSync(componentPath, 'utf8'), 'component');
  const digest = createHash('sha256').update(readFileSync(componentPath)).digest('hex');
  const receipt = JSON.parse(readFileSync(join(exportDirectory, 'receipt.json'), 'utf8'));
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false }).stdout.trim();
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    source: {
      repository: 'https://github.com/tmedanovic/glixo-community-modules',
      commit: git(['rev-parse', 'HEAD^{commit}']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
    },
    language: 'typescript',
    components: [{
      referenceId: 'sample-reference',
      componentId: 'sample-component',
      language: 'typescript',
      recipeId: 'contribution-typescript-v1',
      sourceArtifact: 'dist/glixo-extension.component.wasm',
      artifact: 'components/sample-reference/typescript/sample-component/glixo-extension.component.wasm',
      bytes: Buffer.byteLength('component'),
      sha256: digest,
    }],
  });
  assert.deepEqual(readdirSync(exportDirectory).sort(), ['components', 'receipt.json']);
  assert.equal(existsSync(join(exportDirectory, 'packages')), false);
  assert.equal(existsSync(join(exportDirectory, 'references')), false);
});

test('opt-in export rejects a dirty source tree before creating output', (t) => {
  const root = fixture();
  const exportDirectory = join(tmpdir(), `glixo-reference-dirty-export-${process.pid}-${Date.now()}`);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(exportDirectory, { recursive: true, force: true });
  });
  initializeCleanGitRepository(root);
  writeFileSync(join(root, 'dirty-change.txt'), 'not part of the source commit');
  const result = spawnSync(process.execPath, [script, '--language=typescript', '--export-dir', exportDirectory], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifact export requires a clean source worktree/);
  assert.equal(existsSync(exportDirectory), false);
});

test('opt-in export accepts explicit language and artifact declarations as well', (t) => {
  const root = fixture('.', { schemaVersion: 1, language: 'typescript', components: [
    { id: 'sample-component', language: 'typescript', recipe: 'contribution-typescript-v1', artifact: 'dist/glixo-extension.component.wasm' },
  ] });
  const exportDirectory = join(tmpdir(), `glixo-reference-explicit-export-${process.pid}-${Date.now()}`);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(exportDirectory, { recursive: true, force: true });
  });
  initializeCleanGitRepository(root);
  mkdirSync(exportDirectory);
  const result = spawnSync(process.execPath, [script, '--language=typescript', '--export-dir', exportDirectory], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(join(exportDirectory, 'components', 'sample-reference', 'typescript', 'sample-component', 'glixo-extension.component.wasm')), true);
  assert.equal(existsSync(join(exportDirectory, 'receipt.json')), true);
});

test('opt-in export accepts the repository project-manifest variants without top-level language', (t) => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const manifests = [
    'references/conversation-insights/typescript/glixo.project.json',
    'references/prompt-redactor/typescript/glixo.project.json',
    'references/accessible-theme/typescript/glixo.project.json',
  ];
  for (const [position, manifestPath] of manifests.entries()) {
    const declaration = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8'));
    const root = fixture('.', declaration);
    const exportDirectory = join(tmpdir(), `glixo-reference-current-manifest-${process.pid}-${Date.now()}-${position}`);
    mkdirSync(exportDirectory);
    try {
      initializeCleanGitRepository(root);
      const result = spawnSync(process.execPath, [script, '--language=typescript', '--export-dir', exportDirectory], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, `${manifestPath}\n${result.stdout}\n${result.stderr}`);
      const receipt = JSON.parse(readFileSync(join(exportDirectory, 'receipt.json'), 'utf8'));
      assert.equal(receipt.components.length, 1, manifestPath);
      assert.equal(receipt.components[0].recipeId, 'contribution-typescript-v1', manifestPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  }
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
