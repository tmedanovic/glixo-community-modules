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
const support = existsSync(supportPath) ? JSON.parse(readFileSync(supportPath, 'utf8')) : undefined;
const recipes = support?.recipes;
const forbiddenRoots = ['bundled', 'catalog', 'examples', 'integrations', 'archive'];
for (const path of forbiddenRoots) {
  if (existsSync(join(root, path))) errors.push(`retired active tree remains: ${path}/`);
}
for (const name of readdirSync(root)) {
  if (name.toLowerCase().endsWith('.zip')) errors.push(`old package archive at repository root: ${name}`);
}
function checkLegacyFiles(directory) {
  for (const name of readdirSync(directory)) {
    if (['.git', 'node_modules', 'bin', 'obj', 'target', 'dist'].includes(name)) continue;
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
  if (!recipes || typeof recipes !== 'object' || Array.isArray(recipes)) errors.push('SDK support matrix is missing its recipe registry');
  if (!support.toolchains || typeof support.toolchains !== 'object') errors.push('SDK support matrix is missing pinned toolchain definitions');
  for (const language of ['csharp', 'go', 'rust', 'typescript']) {
    const row = support.languages?.[language];
    if (!row || typeof row.sdkPath !== 'string' || !row.recipeId || !recipes?.[row.recipeId]) errors.push(`SDK support matrix is missing ${language} SDK or recipe data`);
    if (row && !['supported', 'preview', 'planned'].includes(row.status)) errors.push(`${language}: invalid support status`);
  }
  for (const [recipeId, recipe] of Object.entries(recipes ?? {})) {
    if (!['csharp', 'go', 'rust', 'typescript'].includes(recipe.language)) errors.push(`${recipeId}: unsupported recipe language`);
    if (!['component', 'contribution', 'llm-provider'].includes(recipe.kind)) errors.push(`${recipeId}: unsupported recipe kind ${recipe.kind}`);
    if (typeof recipe.world !== 'string' || !recipe.world.includes('@')) errors.push(`${recipeId}: exact versioned world is required`);
    if (!Array.isArray(recipe.build?.steps) || !recipe.build.steps.length) errors.push(`${recipeId}: build steps are required`);
    if (!recipe.build?.verification || typeof recipe.build.verification.tool !== 'string' || !Array.isArray(recipe.build.verification.args)) errors.push(`${recipeId}: component verification recipe is required`);
    for (const step of [...(recipe.build?.steps ?? []), recipe.build?.verification ?? {}]) {
      if (typeof step.tool !== 'string' || !Array.isArray(step.args) || step.args.some((arg) => typeof arg !== 'string')) errors.push(`${recipeId}: malformed immutable argv step`);
    }
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
      if (!Array.isArray(scaffold.sharedPaths) || scaffold.sharedPaths.some((path) => !path || typeof path.sourcePath !== 'string' || !path.sourcePath.startsWith('references/_shared/') || path.sourcePath.split(/[\\/]/).includes('..') || typeof path.destination !== 'string' || path.destination.startsWith('/') || path.destination.split(/[\\/]/).includes('..'))) errors.push(`${item.id}: scaffold.sharedPaths must map explicit shared assets to safe project-relative destinations`);
      else if (item.status !== 'planned') for (const path of scaffold.sharedPaths) if (!existsSync(join(root, path.sourcePath))) errors.push(`${item.id}: shared asset source is missing: ${path.sourcePath}`);
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
  if (item.status === 'planned') {
    warnings.push(`${item.id}: source projects are still planned`);
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
    const source = relative(root, project);
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
    const recipeId = metadata.build?.recipeId;
    const recipe = recipes?.[recipeId];
    if (!recipeId || !recipe) errors.push(`${item.id}/${language}: build.recipeId must resolve through the public SDK recipe registry`);
    else {
      if (recipe.language !== language) errors.push(`${item.id}/${language}: recipe ${recipeId} targets ${recipe.language}`);
      if (item.contract && !item.contract.includes(recipe.world)) errors.push(`${item.id}/${language}: indexed contract does not include recipe world ${recipe.world}`);
    }
    const projectManifest = join(project, 'glixo.project.json');
    if (!existsSync(projectManifest)) errors.push(`${item.id}/${language}: glixo.project.json is required for glxdev scaffolding`);
    else {
      const declaration = JSON.parse(readFileSync(projectManifest, 'utf8'));
      const componentRecipes = declaration.components?.map((component) => component.recipe) ?? [];
      if (!componentRecipes.includes(recipeId)) errors.push(`${item.id}/${language}: glixo.project.json must select recipe ${recipeId}`);
    }
    if (!existsSync(join(project, 'glixo.extension.json'))) errors.push(`${item.id}/${language}: glixo.extension.json is required for scaffolding`);
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
