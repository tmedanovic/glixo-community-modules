import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'packages/extension-sdk/release-manifest.json'), 'utf8'));
const matrix = JSON.parse(readFileSync(resolve(root, 'packages/extension-sdk/support-matrix.json'), 'utf8'));
const ts = JSON.parse(readFileSync(resolve(root, 'packages/extension-sdk/typescript/package.json'), 'utf8'));
const rust = readFileSync(resolve(root, 'packages/extension-sdk/rust/Cargo.toml'), 'utf8');
const csharp = readFileSync(resolve(root, 'packages/extension-sdk/csharp/Glixo.ExtensionSdk/Glixo.ExtensionSdk.csproj'), 'utf8');
const go = readFileSync(resolve(root, 'packages/extension-sdk/go/go.mod'), 'utf8');

function field(source, name) {
  const match = source.match(new RegExp(`<${name}>([^<]+)</${name}>`));
  return match?.[1];
}

function tomlField(source, name) {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1];
}

const packages = manifest.packages || {};
const checks = [
  ['typescript', packages.typescript?.name === ts.name, 'npm package name'],
  ['typescript', packages.typescript?.version === ts.version, 'npm package version'],
  ['typescript', ts.license === 'MIT' && ts.publishConfig?.access === 'public', 'npm public license/access metadata'],
  ['typescript', ts.scripts?.prepack === 'npm run build' && ts.types === './dist/index.d.ts', 'npm build and type entrypoint'],
  ['typescript', ts.files?.includes('dist') && ts.files?.includes('LICENSE'), 'npm publication allowlist'],
  ['csharp', packages.csharp?.name === field(csharp, 'PackageId'), 'NuGet package id'],
  ['csharp', packages.csharp?.version === field(csharp, 'Version'), 'NuGet package version'],
  ['csharp', field(csharp, 'PackageReadmeFile') === 'README.md' && field(csharp, 'RepositoryUrl')?.startsWith('https://'), 'NuGet readme and repository metadata'],
  ['rust', packages.rust?.name === tomlField(rust, 'name'), 'Cargo package name'],
  ['rust', packages.rust?.version === tomlField(rust, 'version'), 'Cargo package version'],
  ['rust', tomlField(rust, 'repository')?.startsWith('https://') && tomlField(rust, 'readme') === 'README.md', 'Cargo repository and readme metadata'],
  ['go', packages.go?.name === go.match(/^module\s+(\S+)$/m)?.[1], 'Go module path'],
  ['matrix', manifest.schemaVersion === 1 && matrix.schemaVersion === 1, 'release manifest and support matrix schemas'],
];

const errors = checks.filter(([, ok]) => !ok).map(([language, , check]) => `${language}: ${check} mismatch`);
for (const language of ['csharp', 'go', 'rust', 'typescript']) {
  if (!matrix.languages?.[language]) errors.push(`support matrix is missing ${language}`);
  if (!/^\d+\.\d+\.\d+$/.test(packages[language]?.version || '')) errors.push(`${language}: release version must be stable semver`);
  if (packages[language]?.publication !== 'not-performed') errors.push(`${language}: release manifest must keep publication state not-performed`);
}

if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified four-language SDK package metadata at version ${packages.typescript.version}; publication remains not-performed.\n`);
}
