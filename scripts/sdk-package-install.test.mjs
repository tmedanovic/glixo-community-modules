import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages', 'extension-sdk', 'typescript');
const versions = JSON.parse(readFileSync(join(root, 'packages', 'extension-sdk', 'release-manifest.json'), 'utf8'));
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

function runNpm(args, cwd) {
  const result = spawnSync(existsSync(npmCli) ? process.execPath : 'npm', [
    ...(existsSync(npmCli) ? [npmCli] : []), ...args,
  ], { cwd, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && !existsSync(npmCli) });
  assert.equal(result.status, 0, `npm ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test('TypeScript SDK packs, installs, and imports from a clean external consumer', { timeout: 180_000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'glixo-sdk-install-'));
  try {
    const staged = join(scratch, 'sdk');
    cpSync(source, staged, { recursive: true, filter: (path) => !/(^|[\\/])(node_modules|dist|\.git)([\\/]|$)/.test(path) });
    cpSync(join(root, 'LICENSE'), join(staged, 'LICENSE'));
    runNpm(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], staged);

    const packedDirectory = join(scratch, 'packed');
    mkdirSync(packedDirectory);
    const packed = JSON.parse(runNpm(['pack', '--json', '--pack-destination', packedDirectory], staged))[0];
    const tarball = join(packedDirectory, packed.filename);
    assert.equal(packed.name, versions.packages.typescript.name);
    assert.equal(packed.version, versions.packages.typescript.version);
    const packedFiles = new Set(packed.files.map((file) => file.path));
    for (const file of ['README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts', 'dist/http.js', 'dist/http.d.ts']) {
      assert.ok(packedFiles.has(file), `packed SDK is missing ${file}`);
    }
    assert.match(createHash('sha256').update(readFileSync(tarball)).digest('hex'), /^[0-9a-f]{64}$/);

    const consumer = join(scratch, 'consumer');
    mkdirSync(consumer);
    runNpm(['install', '--prefix', consumer, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', tarball], scratch);
    const smoke = join(consumer, 'smoke.mjs');
    writeFileSync(smoke, [
      "import assert from 'node:assert/strict';",
      "import * as root from '@glixo/extension-sdk';",
      "import * as http from '@glixo/extension-sdk/http';",
      "import * as wit from '@glixo/extension-sdk/wit';",
      "assert.equal(typeof root.NdjsonStream, 'function');",
      "assert.equal(typeof http.NdjsonStream, 'function');",
      "assert.equal(typeof wit.throwWitError, 'function');",
    ].join('\n'));
    const imported = spawnSync(process.execPath, [smoke], { cwd: consumer, encoding: 'utf8', windowsHide: true });
    assert.equal(imported.status, 0, `${imported.stdout}\n${imported.stderr}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
