import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { join, resolve, sep } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const languages = ['csharp', 'go', 'rust', 'typescript'];
const errors = [];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (message) => errors.push(message);
const index = readJson(join(root, 'references', 'reference-index.json'));
const entry = index.references.find((reference) => reference.id === 'accessible-theme');
if (!entry || entry.kind !== 'executable') fail('accessible-theme must be indexed as an executable installable package template');
if (JSON.stringify(entry?.languages) !== JSON.stringify(languages)) fail('accessible-theme must declare all four contribution guest languages');
if (entry?.hostAcceptance !== 'pending') fail('accessible-theme host acceptance must remain pending until exercised on a host');
const ui = entry?.uiPackage;
if (!ui || ui.runtime !== 'sandboxed-web' || ui.build !== 'static') fail('the browser panel must be identified as a separate static sandboxed-web asset');
if (ui?.assetPath !== 'ui/index.html' || ui?.actionId !== 'save-preferences' || ui?.placement !== 'settings.extensions') fail('the UI package declaration is incomplete or points at an unsupported placement');

const sourcePath = entry?.uiPackage?.sourcePath;
const source = sourcePath ? resolve(root, sourcePath) : '';
if (!source || !source.startsWith(`${resolve(root, 'references', '_shared')}${sep}`) || !existsSync(source)) {
  fail('the canonical browser UI asset must live under references/_shared');
}
const html = source && existsSync(source) ? readFileSync(source, 'utf8') : '';
const digest = source && existsSync(source)
  ? `sha256:${createHash('sha256').update(readFileSync(source)).digest('hex')}`
  : '';
for (const [label, pattern] of [
  ['host bridge bootstrap', /__GLIXO_SANDBOXED_WEB__/],
  ['versioned host bridge envelope', /contractKind:'sandboxed-web-bridge'/],
  ['guest ready event', /operation:'guest\.ready'/],
  ['manifest action', /id:'save-preferences'/],
  ['user custom control', /glixo-user-custom-control/],
  ['semantic host theme tokens', /--glixo-color-background/],
]) if (!pattern.test(html)) fail(`browser UI is missing ${label}`);
if (/<(?:script|link|img)\b[^>]+(?:src|href)\s*=\s*["']https?:/i.test(html)) fail('browser UI must not load remote assets');
if (/window\.open\s*\(|location\.(?:href|assign|replace)\s*=|\bfetch\s*\(/i.test(html)) fail('browser UI must use only the host bridge for external operations');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  try { new Script(match[1], { filename: 'accessible-theme/ui/index.html' }); }
  catch (error) { fail(`browser UI script has a syntax error: ${error instanceof Error ? error.message : String(error)}`); }
}

const placementsPath = join(root, 'references', 'accessible-theme', 'placements.json');
if (!existsSync(placementsPath)) fail('the UI placement registry snapshot is missing');
else {
  const placements = readJson(placementsPath).placements;
  const placement = placements.find((item) => item.id === ui?.placement);
  if (!placement || placement.status !== 'supported' || !placement.renderers.includes('sandboxed-web')) {
    fail(`placement ${ui?.placement ?? '(missing)'} is not declared as a supported sandboxed-web placement`);
  }
}

for (const language of languages) {
  const project = join(root, 'references', 'accessible-theme', language);
  const manifestPath = join(project, 'glixo.extension.json');
  const componentSource = join(project, 'ui', 'index.html');
  const projectManifestPath = join(project, 'glixo.project.json');
  const referencePath = join(project, 'reference.json');
  if (![manifestPath, componentSource, projectManifestPath, referencePath].every(existsSync)) {
    fail(`${language}: package manifest, mapped UI asset, glxdev recipe or reference metadata is missing`);
    continue;
  }
  const manifest = readJson(manifestPath);
  const projectManifest = readJson(projectManifestPath);
  const metadata = readJson(referencePath);
  if (readFileSync(componentSource, 'utf8') !== html) fail(`${language}: packaged HTML differs from the shared source`);
  const uiComponent = manifest.components?.find((component) => component.id === 'panel-ui');
  const guestComponent = manifest.components?.find((component) => component.id === 'panel-actions');
  if (!uiComponent || uiComponent.runtime !== 'sandboxed-web' || uiComponent.cell !== 'browser'
    || uiComponent.artifact !== 'ui/index.html' || uiComponent.digest !== digest) {
    fail(`${language}: browser component must use the digest-bound static HTML asset`);
  }
  const surface = manifest.contributions?.surfaces?.find((item) => item.id === 'themed-custom-panel');
  if (!surface || surface.uiTier !== 'sandboxed-web' || surface.origin !== 'opaque-extension'
    || surface.component !== 'panel-ui' || !surface.placements?.includes('settings.extensions')
    || surface.actions?.length !== 1 || surface.actions[0]?.id !== 'save-preferences'
    || surface.assets?.length !== 1 || surface.assets[0]?.digest !== digest) {
    fail(`${language}: manifest surface must bind the sandboxed panel, static asset, supported placement and declared action`);
  }
  if (!guestComponent || guestComponent.runtime !== 'wasm-component' || guestComponent.world !== 'glixo:contribution/contribution@1.0.0') {
    fail(`${language}: action guest must be a separate contribution-world WASM component`);
  }
  const action = manifest.contributions?.actions?.find((item) => item.id === 'save-preferences');
  if (!action || action.component !== 'panel-actions' || !action.placements?.includes('settings.extensions')) {
    fail(`${language}: save-preferences must route to the contribution guest at the panel placement`);
  }
  if (action?.context !== 'project') fail(`${language}: persistent settings action must require the host-stamped project context`);
  if (manifest.permissions?.requested?.find((permission) => permission.id === 'storage.extension')?.scope?.prefixes?.join() !== 'accessible-theme/preferences/') {
    fail(`${language}: preference persistence must stay inside its declared extension storage prefix`);
  }
  const recipe = `contribution-${language}-v1`;
  if (!projectManifest.components?.some((component) => component.recipe === recipe)
    || metadata.build?.recipeId !== recipe || metadata.hostAcceptance !== 'pending') {
    fail(`${language}: pinned guest build recipe or pending acceptance metadata is missing`);
  }
  const guestSources = language === 'rust' ? ['src/lib.rs']
    : language === 'go' ? ['storage/handler.go']
      : language === 'csharp' ? ['src/StorageHandler.cs']
        : ['src/handler.ts'];
  const guestCode = guestSources.map((file) => readFileSync(join(project, file), 'utf8')).join('\n');
  if (!guestCode.includes('save-preferences') || !guestCode.includes('accessible-theme/preferences/current')) {
    fail(`${language}: contribution guest does not validate and persist the declared panel action`);
  }
  if (!guestCode.includes('sessionId') && !guestCode.includes('SessionID') && !guestCode.includes('session_id')) {
    fail(`${language}: contribution guest must validate the host-stamped invocation session`);
  }
}

if (errors.length) {
  console.error(`UI reference verification failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log('Verified static sandboxed-web UI digest, supported placement, action bridge declaration, four language guest mappings, and scoped storage metadata.');
}
