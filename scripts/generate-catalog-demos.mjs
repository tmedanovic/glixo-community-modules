#!/usr/bin/env node
/**
 * Generate demo/demo.replay.json + demos[] for marketplace catalog extensions.
 * Run from glixo-community-modules: node scripts/generate-catalog-demos.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const SCAN_ROOTS = [
  ['catalog', 'code'],
  ['catalog', 'agxos', 'apps'],
  ['catalog', 'agxos', 'extensions'],
];

function encodeReplayDoc(doc) {
  const json = JSON.stringify(doc);
  const encoded = `1.${Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  return encoded;
}

function toolEvent(id, app, action, args = {}) {
  return {
    id,
    name: 'code_os_use_app',
    phase: 'end',
    state: 'completed',
    theater: true,
    input: { app, action, args },
    at: 0,
  };
}

function actionArgs(actionId) {
  if (actionId === 'write') {
    return { text: 'Sample note from the agent demo.' };
  }
  if (actionId === 'add') {
    return { text: 'Follow-up line from the agent.' };
  }
  return {};
}

function buildAgxosAppReplay({ extensionId, appId, appName, actions }) {
  const turns = [[toolEvent(`${appId}-open`, appId, 'open')]];
  const captions = [`Open ${appName}`];
  const first = actions?.[0]?.id;
  if (first) {
    turns.push([toolEvent(`${appId}-${first}`, appId, first, actionArgs(first))]);
    captions.push(`Run ${first}`);
  } else {
    turns.push([toolEvent(`${appId}-focus`, appId, 'bringToFront')]);
    captions.push(`Focus ${appName}`);
  }
  return {
    v: 1,
    title: `${appName} demo`,
    skin: 'windows',
    extensionId,
    createdAt: Date.now(),
    turns,
    captions,
  };
}

function buildMarketplaceReplay({ extensionId, name }) {
  return {
    v: 1,
    title: `${name} demo`,
    skin: 'windows',
    extensionId,
    createdAt: Date.now(),
    turns: [
      [toolEvent('mp-open', 'marketplace', 'openExtension', { extensionId })],
      [toolEvent('mp-focus', 'marketplace', 'bringToFront')],
    ],
    captions: [
      `Open ${name} in the Marketplace`,
      'Browse install details and screenshots',
    ],
  };
}

function extractAgxosApps(manifest) {
  const agxos = manifest.contributes?.agxos;
  if (!agxos || typeof agxos !== 'object' || !Array.isArray(agxos.apps)) return [];
  return agxos.apps.filter((app) => app && typeof app === 'object');
}

function buildReplayForManifest(manifest) {
  const extensionId = manifest.id;
  const name = manifest.name ?? extensionId;
  const apps = extractAgxosApps(manifest);
  if (apps.length > 0) {
    const primary = apps[0];
    const appId = String(primary.id ?? '').trim();
    const appName = String(primary.name ?? name).trim();
    if (!appId) return null;
    return buildAgxosAppReplay({
      extensionId,
      appId,
      appName,
      actions: Array.isArray(primary.actions) ? primary.actions : [],
    });
  }
  return buildMarketplaceReplay({ extensionId, name });
}

function collectManifestPaths() {
  const paths = [];
  for (const segments of SCAN_ROOTS) {
    const dir = path.join(repoRoot, ...segments);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSafe(dir)) {
      const manifestPath = path.join(dir, entry.name, 'glixo.module.json');
      if (entry.isDirectory() && existsSync(manifestPath)) {
        paths.push(manifestPath);
      }
    }
  }
  return paths.sort();
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function writeDemo(manifestPath, doc) {
  const moduleRoot = path.dirname(manifestPath);
  const demoDir = path.join(moduleRoot, 'demo');
  mkdirSync(demoDir, { recursive: true });
  const encoded = encodeReplayDoc(doc);
  const replayPath = path.join(demoDir, 'demo.replay.json');
  writeFileSync(replayPath, `${JSON.stringify({ ...doc, encoded }, null, 2)}\n`);
  return { replayPath: 'demo/demo.replay.json', encoded };
}

function updateManifest(manifestPath, manifest, replayPath) {
  const demoId = 'intro';
  const title = manifest.demos?.[0]?.title ?? `${manifest.name ?? manifest.id} demo`;
  manifest.demos = [{
    id: demoId,
    kind: 'replay',
    title,
    replayPath,
  }];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

let generated = 0;
let skipped = 0;

for (const manifestPath of collectManifestPaths()) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.catalog?.listed === false) {
    skipped += 1;
    console.log(`skip (not listed): ${manifest.id}`);
    continue;
  }
  const doc = buildReplayForManifest(manifest);
  if (!doc) {
    skipped += 1;
    console.log(`skip (no replay): ${manifest.id}`);
    continue;
  }
  const { replayPath } = writeDemo(manifestPath, doc);
  updateManifest(manifestPath, manifest, replayPath);
  generated += 1;
  console.log(`demo: ${manifest.id} -> ${replayPath}`);
}

console.log(`\nDone. Generated ${generated} demo(s), skipped ${skipped}.`);
console.log('Next: cd ../glixo-dev-portal && npm run catalog:sync');
