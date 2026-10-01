import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const indexPath = join(root, 'references', 'reference-index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const supportPath = join(root, 'packages', 'extension-sdk', 'support-matrix.json');
const errors = [];
const warnings = [];
const allowedLanguages = new Set(['csharp', 'go', 'rust', 'typescript']);
const forbiddenRoots = ['bundled', 'catalog', 'examples', 'integrations', 'archive'];
for (const path of forbiddenRoots) {
  if (existsSync(join(root, path))) errors.push(`retired active tree remains: ${path}/`);
}
for (const name of readdirSync(root)) {
  if (name.toLowerCase().endsWith('.zip')) errors.push(`old package archive at repository root: ${name}`);
}
function checkLegacyFiles(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) { errors.push(`symbolic link is not allowed in references: ${relative(root, path)}`); continue; }
    if (info.isDirectory()) checkLegacyFiles(path);
    else {
      if (name.toLowerCase().endsWith('.zip')) errors.push(`legacy package archive: ${relative(root, path)}`);
      if (name === 'glixo.module.json') errors.push(`module-v0 descriptor: ${relative(root, path)}`);
      if (name === 'adapter.cjs') errors.push(`retired Node/stdio adapter: ${relative(root, path)}`);
    }
  }
}
checkLegacyFiles(join(root, 'references'));
if (index.schemaVersion !== 1 || !Array.isArray(index.references)) errors.push('unsupported or malformed reference index');
if (!existsSync(supportPath)) errors.push('public SDK support matrix is missing');
else {
  const support = JSON.parse(readFileSync(supportPath, 'utf8'));
  for (const language of ['csharp', 'go', 'rust', 'typescript']) {
    const row = support.languages?.[language];
    if (!row || !Array.isArray(row.toolchain) || !row.toolchain.length || !row.recipeId) errors.push(`SDK support matrix is missing pinned ${language} build data`);
    if (row && !['supported', 'preview', 'planned'].includes(row.status)) errors.push(`${language}: invalid support status`);
  }
}
const seen = new Set();
for (const item of index.references ?? []) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id ?? '')) errors.push(`invalid reference id: ${item.id}`);
  if (seen.has(item.id)) errors.push(`duplicate reference id: ${item.id}`);
  seen.add(item.id);
  if (!['executable', 'assets', 'checklist'].includes(item.kind)) errors.push(`${item.id}: invalid kind ${item.kind}`);
  if (!['supported', 'preview', 'planned'].includes(item.status)) errors.push(`${item.id}: invalid status ${item.status}`);
  if (item.kind === 'executable') {
    const scaffold = item.scaffold;
    if (!scaffold || typeof scaffold !== 'object') errors.push(`${item.id}: scaffold paths are required for glxdev`);
    else {
      const expected = {
        sourcePath: `references/${item.id}/{language}`,
        manifestPath: `references/${item.id}/{language}/glixo.extension.json`,
        projectManifestPath: `references/${item.id}/{language}/glixo.project.json`,
      };
      for (const [key, value] of Object.entries(expected)) {
        if (scaffold[key] !== value) errors.push(`${item.id}: scaffold.${key} must be ${value}`);
      }
      if (!Array.isArray(scaffold.sharedPaths) || scaffold.sharedPaths.some((path) => !path || typeof path.sourcePath !== 'string' || !path.sourcePath.startsWith('references/_shared/') || typeof path.destination !== 'string' || path.destination.startsWith('/') || path.destination.split(/[\\/]/).includes('..'))) errors.push(`${item.id}: scaffold.sharedPaths must map explicit shared assets to safe project-relative destinations`);
      if (!scaffold.substitutions || scaffold.substitutions['{{PACKAGE_ID}}'] !== 'package.id' || scaffold.substitutions['{{NAME}}'] !== 'package.name' || scaffold.substitutions['{{PUBLISHER}}'] !== 'package.publisher') errors.push(`${item.id}: scaffold metadata substitutions are incomplete`);
    }
  }
  if (item.kind !== 'executable') {
    if ((item.languages ?? []).length) errors.push(`${item.id}: non-executable reference has guest language projects`);
    continue;
  }
  const languages = item.languages ?? [];
  if (languages.length !== allowedLanguages.size || [...languages].some((language) => !allowedLanguages.has(language))) {
    errors.push(`${item.id}: executable reference must declare C#, Go, Rust, and TypeScript`);
    continue;
  }
  const base = join(root, 'references', item.id);
  if (!existsSync(base)) {
    if (item.status === 'planned') { warnings.push(`${item.id}: source projects are still planned`); continue; }
    errors.push(`${item.id}: source directory is missing`);
    continue;
  }
  for (const language of languages) {
    const project = join(base, language);
    if (!existsSync(project)) {
      if (item.status === 'planned') continue;
      errors.push(`${item.id}/${language}: project directory is missing`);
      continue;
    }
    const source = relative(project, root);
    if (source.startsWith('..')) errors.push(`${item.id}/${language}: project escaped references root`);
    const entries = readdirSync(project);
    if (!entries.length) errors.push(`${item.id}/${language}: empty project`);
    const readme = join(project, 'README.md');
    if (!existsSync(readme)) errors.push(`${item.id}/${language}: README with runnable instructions is required`);
    const projectFile = join(project, 'reference.json');
    if (!existsSync(projectFile)) {
      errors.push(`${item.id}/${language}: reference.json must record contract and source status`);
      continue;
    }
    const metadata = JSON.parse(readFileSync(projectFile, 'utf8'));
    if (metadata.referenceId !== item.id || metadata.language !== language) errors.push(`${item.id}/${language}: reference.json identity mismatch`);
    if (!Array.isArray(metadata.build) || !metadata.build.length) errors.push(`${item.id}/${language}: build command is required`);
    if (!Array.isArray(metadata.contractChecks) || !metadata.contractChecks.length) errors.push(`${item.id}/${language}: meaningful contractChecks are required`);
    if (metadata.placeholder === true) errors.push(`${item.id}/${language}: placeholder implementations are forbidden`);
    if (metadata.hostAcceptance === 'passed' && metadata.status !== 'supported') warnings.push(`${item.id}/${language}: host acceptance is passed; update the reference-level status after aggregate review`);
  }
}
const shared = join(root, 'references', '_shared');
if (!existsSync(join(shared, 'README.md'))) errors.push('references/_shared/README.md is missing');
if (index.provenance) errors.push('do not embed a self-referential commit pin in the public index; use the consuming repository lock');
if (warnings.length) {
  console.log(`Planned references (${warnings.length}):`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (errors.length) {
  console.error(`Reference verification failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${seen.size} reference entries; ${warnings.length} executable reference(s) remain planned.`);
}
