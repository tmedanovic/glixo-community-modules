#!/usr/bin/env node
/**
 * Pack installable catalog extensions into artifacts/*.zip and refresh sha256 in glixo.module.json.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// Resolve adm-zip from this repo first (run `npm install` here), then fall back
// to a sibling glixo-portals/dev checkout that declares the same dependency.
function loadAdmZip() {
  const candidates = [
    path.join(scriptDir, '..', 'package.json'),
    path.join(scriptDir, '../../glixo-portals/dev/package.json'),
  ];
  for (const base of candidates) {
    try {
      return createRequire(base)('adm-zip');
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    "Cannot resolve 'adm-zip'. Run `npm install` in glixo-community-modules (or install deps in a sibling glixo-portals/dev checkout).",
  );
}
const AdmZip = loadAdmZip();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CATALOG_ROOTS = [
  'catalog/code',
  'catalog/agxos/apps',
  'catalog/agxos/extensions',
];
// ZIP stores timestamps as local DOS fields and adm-zip records the host OS in
// "version made by". Set encoded values directly and store canonical text so
// Windows and Linux produce byte-identical artifacts.
const FIXED_DOS_TIME = 0x00210000; // 1980-01-01 00:00:00
const FIXED_MADE_BY = 0x0314; // UNIX, ZIP specification 2.0
const STORED_METHOD = 0; // Avoid zlib-version-dependent deflate output.
const CANONICAL_TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);

function findManifests() {
  const manifests = [];
  for (const scanRoot of CATALOG_ROOTS) {
    const root = path.join(repoRoot, scanRoot);
    if (!existsSync(root)) continue;
    for (const entry of sortedEntries(root)) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(root, entry.name, 'glixo.module.json');
      if (existsSync(manifestPath)) manifests.push(manifestPath);
    }
  }
  return manifests;
}

function shouldSkip(name) {
  return name === '.git' || name === 'node_modules' || name === 'bin' || name === 'obj' || name === 'artifacts';
}

function addDirectory(zip, directory, zipRoot) {
  for (const entry of sortedEntries(directory)) {
    if (shouldSkip(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const zipPath = path.posix.join(zipRoot, entry.name);
    if (entry.isDirectory()) {
      addDirectory(zip, fullPath, zipPath);
      continue;
    }
    if (entry.isFile()) {
      // The catalog manifest is delivered separately and copied into the final
      // install directory by ModuleInstallRunner. Including it here would make
      // the archive hash self-referential through artifacts[].sha256.
      if (zipPath === 'glixo.module.json') continue;
      const zipEntry = zip.addFile(zipPath, readPackageFile(fullPath));
      zipEntry.header.timeval = FIXED_DOS_TIME;
      zipEntry.header.made = FIXED_MADE_BY;
      zipEntry.header.method = STORED_METHOD;
    }
  }
}

function sortedEntries(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function readPackageFile(filePath) {
  const bytes = readFileSync(filePath);
  if (!CANONICAL_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

let packed = 0;
for (const manifestPath of findManifests()) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.catalog?.listed === false) {
    console.log(`skip (unlisted): ${manifest.id}`);
    continue;
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length === 0) {
    console.warn(`skip (no artifacts): ${manifest.id}`);
    continue;
  }

  const moduleRoot = path.dirname(manifestPath);
  const artifactsDir = path.join(moduleRoot, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  for (const artifact of artifacts) {
    if (!artifact?.url || !String(artifact.url).startsWith('artifacts/')) continue;
    const zipName = path.basename(artifact.url);
    const zipPath = path.join(artifactsDir, zipName);
    if (existsSync(zipPath)) rmSync(zipPath);

    const zip = new AdmZip();
    // Pack at the module root: entries have no folder prefix, so glixo.module.json
    // and assets/ sit at the zip root where the install runner expects them.
    addDirectory(zip, moduleRoot, '');
    zip.writeZip(zipPath);

    artifact.sha256 = sha256File(zipPath);
    console.log(`packed ${manifest.id} -> ${artifact.url} (${artifact.sha256.slice(0, 12)}…)`);
    packed += 1;
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Done. Packed ${packed} artifact(s).`);
