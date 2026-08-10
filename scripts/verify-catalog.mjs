#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DETERMINISTIC_DOS_TIME = 0x00210000;
const DETERMINISTIC_MADE_BY = 0x0314;
const DETERMINISTIC_COMPRESSION_METHOD = 0;
const failures = [];
const ids = new Map();

verifyTree('catalog', { listed: true, packagesRequired: true });
verifyTree('examples', { listed: false, packagesRequired: false });

if (failures.length > 0) {
  console.error(`Community module verification failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Verified ${ids.size} unique community module manifest(s); catalog and examples remain separate.`);

function verifyTree(relativeRoot, policy) {
  const root = path.join(repoRoot, relativeRoot);
  for (const manifestPath of walk(root).filter((file) => path.basename(file) === 'glixo.module.json')) {
    verifyManifest(manifestPath, relativeRoot, policy);
  }
  for (const sourcePath of walk(root).filter((file) => /\.(?:c?js|mjs)$/i.test(file) && !file.includes(`${path.sep}artifacts${path.sep}`))) {
    try {
      execFileSync(process.execPath, ['--check', sourcePath], { stdio: 'pipe' });
    } catch (error) {
      failures.push(`${relative(sourcePath)}: JavaScript syntax check failed (${String(error.stderr ?? error.message).trim()})`);
    }
  }
}

function verifyManifest(manifestPath, relativeRoot, policy) {
  const manifestName = relative(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(`${manifestName}: invalid JSON (${error.message})`);
    return;
  }

  if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
    failures.push(`${manifestName}: missing id`);
  } else if (ids.has(manifest.id)) {
    failures.push(`${manifestName}: duplicate id ${manifest.id} (also ${ids.get(manifest.id)})`);
  } else {
    ids.set(manifest.id, manifestName);
  }

  if (policy.listed && manifest.catalog?.listed === false) {
    failures.push(`${manifestName}: catalog products cannot be marked unlisted`);
  }
  if (!policy.listed && manifest.catalog?.listed !== false) {
    failures.push(`${manifestName}: examples must declare catalog.listed: false`);
  }

  for (const unsupported of ['routes', 'contextMenuItems']) {
    if (Array.isArray(manifest.contributes?.[unsupported]) && manifest.contributes[unsupported].length > 0) {
      failures.push(`${manifestName}: contributes.${unsupported} is not mounted by the public host`);
    }
  }

  const root = path.dirname(manifestPath);
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (policy.packagesRequired && artifacts.length === 0) failures.push(`${manifestName}: catalog product has no artifact`);
  for (const artifact of artifacts) {
    verifyArtifact(root, manifestName, artifact, runtimeEntries(manifest), {
      deterministic: policy.packagesRequired,
    });
  }

  if (!policy.packagesRequired && artifacts.length === 0) {
    for (const entry of runtimeEntries(manifest)) {
      const entryPath = path.resolve(root, entry);
      if (!isInside(root, entryPath) || !existsSync(entryPath)) failures.push(`${manifestName}: missing declared source entry ${entry}`);
    }
  }

  if (relativeRoot === 'catalog' && manifest.sourceRepository?.url
    && manifest.sourceRepository.url !== 'https://github.com/tmedanovic/glixo-community-modules') {
    failures.push(`${manifestName}: sourceRepository must point at the canonical GitHub repository`);
  }
}

function verifyArtifact(root, manifestName, artifact, expectedEntries, policy) {
  if (typeof artifact?.url !== 'string' || !artifact.url.toLowerCase().endsWith('.zip')) {
    failures.push(`${manifestName}: artifact must reference a local ZIP`);
    return;
  }
  const artifactPath = path.resolve(root, artifact.url);
  if (!isInside(root, artifactPath) || !existsSync(artifactPath)) {
    failures.push(`${manifestName}: missing artifact ${artifact.url}`);
    return;
  }
  if (!/^[0-9a-f]{64}$/i.test(artifact.sha256 ?? '')) {
    failures.push(`${manifestName}: artifact ${artifact.url} needs a real SHA-256`);
    return;
  }
  const actual = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
  if (actual !== artifact.sha256.toLowerCase()) failures.push(`${manifestName}: artifact hash mismatch for ${artifact.url}`);
  let packedEntries;
  try {
    packedEntries = new AdmZip(artifactPath).getEntries();
  } catch (error) {
    failures.push(`${manifestName}: artifact ${artifact.url} is not a readable ZIP (${error.message})`);
    return;
  }
  const entries = new Set(packedEntries.map((entry) => normalize(entry.entryName)));
  if (policy.deterministic && entries.has('glixo.module.json')) {
    failures.push(`${manifestName}: artifact ${artifact.url} embeds the self-referential catalog manifest`);
  }
  for (const entry of policy.deterministic ? packedEntries : []) {
    if (
      entry.header.timeval !== DETERMINISTIC_DOS_TIME
      || entry.header.made !== DETERMINISTIC_MADE_BY
      || entry.header.method !== DETERMINISTIC_COMPRESSION_METHOD
    ) {
      failures.push(`${manifestName}: artifact ${artifact.url} has non-deterministic metadata for ${entry.entryName}`);
    }
  }
  for (const entry of expectedEntries) {
    if (!entries.has(normalize(entry))) failures.push(`${manifestName}: artifact ${artifact.url} omits declared entry ${entry}`);
  }
}

function runtimeEntries(manifest) {
  const entries = new Set();
  addCommandEntry(entries, manifest.entry);
  for (const component of manifest.components ?? []) addCommandEntry(entries, component.entry);
  for (const server of manifest.contributes?.mcpServers ?? []) addCommandEntry(entries, server);
  for (const adapter of manifest.contributes?.adapters ?? []) addCommandEntry(entries, adapter);
  for (const app of manifest.contributes?.agxos?.apps ?? []) {
    if (typeof app.entry === 'string' && app.entry.trim()) entries.add(normalize(app.entry));
  }
  return [...entries];
}

function addCommandEntry(entries, entry) {
  if (!entry || entry.command !== 'node') return;
  const script = Array.isArray(entry.args) ? entry.args.find((arg) => typeof arg === 'string' && /\.(?:c?js|mjs)$/i.test(arg)) : null;
  if (script) entries.add(normalize(path.posix.join(normalize(entry.workingDirectory ?? '.'), normalize(script))));
}

function walk(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    if (statSync(fullPath).isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function normalize(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function isInside(root, candidate) {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function relative(file) {
  return normalize(path.relative(repoRoot, file));
}
