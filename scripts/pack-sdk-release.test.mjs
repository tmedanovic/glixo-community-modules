import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureContained } from './pack-sdk-release.mjs';

test('SDK release containment accepts a regular Cargo archive under its scratch target', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glixo-sdk-release-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'cargo-target');
  const archive = join(target, 'package', 'glixo-extension-sdk-0.1.0.crate');
  mkdirSync(join(target, 'package'), { recursive: true });
  writeFileSync(archive, 'cargo archive');

  assert.equal(ensureContained(archive, target), archive);
  const releaseOutput = join(root, '.glixo', 'dist', 'sdk-release');
  const packageArchive = join(releaseOutput, 'cargo', 'glixo-extension-sdk-0.1.0.crate');
  mkdirSync(join(releaseOutput, 'cargo'), { recursive: true });
  cpSync(archive, packageArchive);
  assert.equal(ensureContained(packageArchive, releaseOutput), packageArchive);
});

test('SDK release containment rejects artifacts outside the selected staging root', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glixo-sdk-release-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'cargo-target');
  const outside = join(root, 'elsewhere.crate');
  mkdirSync(target);
  writeFileSync(outside, 'not the staged crate');

  assert.throws(() => ensureContained(outside, target), /escaped permitted directory/);
});

test('SDK release containment rejects symlinked files even when their targets are inside the root', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'glixo-sdk-release-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, 'cargo-target');
  const archive = join(target, 'package', 'glixo-extension-sdk-0.1.0.crate');
  const alias = join(target, 'package', 'alias.crate');
  mkdirSync(join(target, 'package'), { recursive: true });
  writeFileSync(archive, 'cargo archive');
  try {
    symlinkSync(archive, alias, 'file');
  } catch (error) {
    if (['EPERM', 'ENOSYS', 'EACCES'].includes(error?.code)) {
      t.skip(`file symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.equal(existsSync(alias), true);
  assert.throws(() => ensureContained(alias, target), /regular file/);
});
