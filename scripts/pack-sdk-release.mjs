#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(readFileSync(join(root, 'packages', 'extension-sdk', 'release-manifest.json'), 'utf8')).packages;
const output = resolve(process.argv[2] || join(root, '.glixo', 'dist', 'sdk-release', versions.typescript.version));
const outputRelative = relative(root, output);
if (!outputRelative || outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || !outputRelative.startsWith('.glixo')) {
  throw new Error(`SDK release output must be contained under the ignored .glixo directory: ${output}`);
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && command.endsWith('.cmd') });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr || result.error || result.stdout).trim()}`);
  }
  return String(result.stdout || '').trim();
}

function sha256(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function ensureContained(file) {
  const absolute = resolve(file);
  const rel = relative(output, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Release artifact escaped output directory: ${absolute}`);
  if (!statSync(absolute).isFile()) throw new Error(`Release artifact is not a regular file: ${absolute}`);
  return absolute;
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in SDK package output: ${file}`);
    if (entry.isDirectory()) files.push(...listFiles(file));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Unsupported entry in SDK package output: ${file}`);
  }
  return files;
}

function verifyCleanSource() {
  const revision = run('git', ['rev-parse', 'HEAD'], root);
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('SDK release requires a full Git commit SHA.');
  if (run('git', ['status', '--porcelain', '--untracked-files=all'], root)) throw new Error('SDK release requires a clean public source commit.');
  return revision;
}

function main() {
  const sourceRevision = verifyCleanSource();
  run(process.execPath, ['scripts/verify-sdk-packages.mjs'], root);
  if (existsSync(output)) throw new Error(`SDK release output already exists; choose a fresh path: ${output}`);
  for (const ecosystem of ['npm', 'nuget', 'cargo', 'go']) mkdirSync(join(output, ecosystem), { recursive: true });

  const scratch = mkdtempSync(join(tmpdir(), 'glixo-sdk-release-'));
  const artifacts = [];
  let goStatus = 'source-tag-required';
  let goValidation = 'not-run: Go toolchain unavailable';
  try {
    const source = join(root, 'packages', 'extension-sdk', 'typescript');
    const staged = join(scratch, 'typescript-sdk');
    cpSync(source, staged, { recursive: true, filter: (path) => !/(^|[\\/])(node_modules|dist|\.git)([\\/]|$)/.test(path) });
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npmCommand = existsSync(npmCli) ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const npmPrefix = existsSync(npmCli) ? [npmCli] : [];
    run(npmCommand, [...npmPrefix, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], staged);
    const npmOutput = JSON.parse(run(npmCommand, [...npmPrefix, 'pack', '--json', '--pack-destination', join(output, 'npm')], staged))[0];
    const npmArchive = ensureContained(join(output, 'npm', npmOutput.filename));
    artifacts.push({ ecosystem: 'npm', package: versions.typescript.name, version: versions.typescript.version, file: relative(root, npmArchive).replaceAll('\\', '/'), sha256: sha256(npmArchive), bytes: statSync(npmArchive).size });

    const csharpSource = join(root, 'packages', 'extension-sdk', 'csharp');
    const csharpStaged = join(scratch, 'csharp-sdk');
    cpSync(csharpSource, csharpStaged, { recursive: true, filter: (path) => !/(^|[\\/])(obj|bin)([\\/]|$)/.test(path) });
    const dotnetOut = join(output, 'nuget');
    run('dotnet', ['pack', join(csharpStaged, 'Glixo.ExtensionSdk', 'Glixo.ExtensionSdk.csproj'), '--configuration', 'Release', '--output', dotnetOut, '--verbosity', 'minimal'], root);
    const nupkg = listFiles(dotnetOut).find((file) => basename(file).toLowerCase() === 'glixo.extensionsdk.0.1.0.nupkg');
    if (!nupkg) throw new Error('NuGet pack did not emit Glixo.ExtensionSdk.0.1.0.nupkg.');
    ensureContained(nupkg);
    artifacts.push({ ecosystem: 'nuget', package: versions.csharp.name, version: versions.csharp.version, file: relative(root, nupkg).replaceAll('\\', '/'), sha256: sha256(nupkg), bytes: statSync(nupkg).size });

    const rustStaged = join(scratch, 'rust-sdk');
    cpSync(join(root, 'packages', 'extension-sdk', 'rust'), rustStaged, { recursive: true, filter: (path) => !/(^|[\\/])(target)([\\/]|$)/.test(path) });
    const cargoTarget = join(scratch, 'cargo-target');
    run('cargo', ['package', '--no-verify', '--allow-dirty', '--manifest-path', join(rustStaged, 'Cargo.toml')], root, { ...process.env, CARGO_TARGET_DIR: cargoTarget });
    const crate = join(cargoTarget, 'package', 'glixo-extension-sdk-0.1.0.crate');
    ensureContained(crate);
    const crateTarget = join(output, 'cargo', basename(crate));
    cpSync(crate, crateTarget);
    artifacts.push({ ecosystem: 'cargo', package: versions.rust.name, version: versions.rust.version, file: relative(root, crateTarget).replaceAll('\\', '/'), sha256: sha256(crateTarget), bytes: statSync(crateTarget).size });

    try {
      run('go', ['test', './...'], join(root, 'packages', 'extension-sdk', 'go'));
      goStatus = 'source-qualified';
      goValidation = 'go test ./... passed';
    } catch (error) {
      if (!/go.*(not recognized|not found|ENOENT)/i.test(String(error))) throw error;
      goValidation = 'not-run: Go toolchain unavailable on the packaging host';
    }
  } finally {
    const scratchResolved = resolve(scratch);
    if (!scratchResolved.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(scratchResolved).startsWith('glixo-sdk-release-')) {
      throw new Error('Unsafe SDK release staging path.');
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  const receipt = {
    schema: 'glixo.extension-sdk.release-receipt.v1',
    source: { repository: 'https://github.com/tmedanovic/glixo-community-modules.git', revision: sourceRevision, clean: true },
    packages: artifacts,
    go: { package: versions.go.name, version: versions.go.version, sourcePath: 'packages/extension-sdk/go', status: goStatus, validation: goValidation },
    publication: 'not-performed',
    signatures: null,
  };
  writeFileSync(join(output, 'release-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...receipt, output: relative(root, output).replaceAll('\\', '/') })}\n`);
}

main();
