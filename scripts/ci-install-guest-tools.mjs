import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const matrix = JSON.parse(readFileSync(new URL('../packages/extension-sdk/support-matrix.json', import.meta.url)));
const versions = {
  componentizeGo: matrix.toolchains?.go?.componentizeGo?.version,
  wasmTools: matrix.toolchains?.rust?.wasmTools?.version,
};
if (versions.componentizeGo !== '0.4.3' || versions.wasmTools !== '1.239.0') {
  throw new Error('Guest tool release pins changed; update and verify the CI archive digests');
}

const assets = {
  componentizeGo: {
    linux: {
      name: 'componentize-go-linux-amd64.tar.gz',
      url: 'https://github.com/bytecodealliance/componentize-go/releases/download/v0.4.3/componentize-go-linux-amd64.tar.gz',
      sha256: '1061d845f550df5d9477612a7d458a31b1e2b8bdc95823704e42e5064deb0c52',
      member: 'componentize-go',
      binary: 'componentize-go',
    },
  },
  wasmTools: {
    linux: {
      name: 'wasm-tools-1.239.0-x86_64-linux.tar.gz',
      url: 'https://github.com/bytecodealliance/wasm-tools/releases/download/v1.239.0/wasm-tools-1.239.0-x86_64-linux.tar.gz',
      sha256: 'be1764c1718a2ed90cdd3e1ed2fe6e4c6b3e2b69fb6ba9a85bcafdca5146a3b9',
      member: 'wasm-tools-1.239.0-x86_64-linux/wasm-tools',
      binary: 'wasm-tools',
    },
    win32: {
      name: 'wasm-tools-1.239.0-x86_64-windows.zip',
      url: 'https://github.com/bytecodealliance/wasm-tools/releases/download/v1.239.0/wasm-tools-1.239.0-x86_64-windows.zip',
      sha256: '039b1eaa170563f762355a23c5ee709790199433e35e5364008521523e9e3398',
      member: 'wasm-tools-1.239.0-x86_64-windows/wasm-tools.exe',
      binary: 'wasm-tools.exe',
    },
  },
};

const language = process.env.EXTENSION_LANGUAGE;
if (!['csharp', 'go', 'rust', 'typescript'].includes(language)) {
  throw new Error(`Unknown extension language: ${language}`);
}
const selected = language === 'go' ? ['componentizeGo', 'wasmTools'] : ['wasmTools'];

if (process.argv.includes('--check')) {
  for (const tool of selected) {
    if (!assets[tool][process.platform]) throw new Error(`No ${tool} archive for ${process.platform}`);
    console.log(`${tool}: ${assets[tool][process.platform].sha256}`);
  }
  process.exit(0);
}

if (!process.env.GITHUB_PATH || !process.env.RUNNER_TEMP) {
  throw new Error('GITHUB_PATH and RUNNER_TEMP are required for CI tool installation');
}
const toolDir = join(process.env.RUNNER_TEMP, 'glixo-tools');
mkdirSync(toolDir, { recursive: true });

for (const tool of selected) {
  const asset = assets[tool][process.platform];
  if (!asset) throw new Error(`No ${tool} archive for ${process.platform}`);
  const stage = mkdtempSync(join(process.env.RUNNER_TEMP, 'glixo-tool-stage-'));
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download ${asset.name} failed: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(data).digest('hex');
  if (digest !== asset.sha256) throw new Error(`${asset.name} SHA-256 mismatch: ${digest}`);
  const archive = join(stage, asset.name);
  writeFileSync(archive, data);
  const extracted = spawnSync('tar', ['-xf', archive, '-C', stage], { stdio: 'inherit' });
  if (extracted.status !== 0) throw new Error(`Extract ${asset.name} failed`);
  const binary = join(toolDir, asset.binary);
  copyFileSync(join(stage, asset.member), binary);
  if (process.platform !== 'win32') chmodSync(binary, 0o755);
  console.log(`Installed ${asset.binary} ${versions[tool]}`);
}
appendFileSync(process.env.GITHUB_PATH, `${toolDir}\n`);
