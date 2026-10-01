import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, 'references', 'reference-index.json'), 'utf8'));
const support = JSON.parse(readFileSync(join(root, 'packages', 'extension-sdk', 'support-matrix.json'), 'utf8'));
const languageArg = process.argv.find((argument) => argument.startsWith('--language='));
const selectedLanguage = languageArg?.slice('--language='.length);
const allowedLanguages = new Set(['csharp', 'go', 'rust', 'typescript']);
const allowedTools = new Set(['cargo', 'componentize-go', 'dotnet', 'go', 'node', 'npm', 'wasm-tools']);
if (selectedLanguage && !allowedLanguages.has(selectedLanguage)) throw new Error(`unsupported language: ${selectedLanguage}`);
const failures = [];
let executed = 0;

function insideProject(project, relativePath, label) {
  if (typeof relativePath !== 'string' || isAbsolute(relativePath)) throw new Error(`${label} must be a relative path`);
  const fullPath = resolve(project, relativePath);
  if (fullPath !== project && !fullPath.startsWith(`${project}${sep}`)) throw new Error(`${label} escapes project root`);
  return fullPath;
}

function run(project, step, label) {
  if (!allowedTools.has(step.tool) || !Array.isArray(step.args) || step.args.some((arg) => typeof arg !== 'string')) {
    throw new Error(`${label} has an unsupported tool or malformed argv`);
  }
  const cwd = insideProject(project, step.cwd ?? '.', `${label}.cwd`);
  const result = spawnSync(step.tool, step.args, { cwd, encoding: 'utf8', stdio: 'inherit', shell: false });
  executed += 1;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: ${step.tool} exited ${result.status}`);
  if (step.output) {
    insideProject(project, step.output, `${label}.output`);
    const matches = globSync(step.output, { cwd: project });
    if (!matches.length) throw new Error(`${label}: expected output ${step.output} was not created`);
  }
}

for (const reference of index.references.filter((item) => item.kind === 'executable' && item.status !== 'planned')) {
  for (const language of reference.languages) {
    if (selectedLanguage && language !== selectedLanguage) continue;
    const project = resolve(root, 'references', reference.id, language);
    const metadataPath = join(project, 'reference.json');
    try {
      if (!existsSync(metadataPath)) throw new Error('reference.json is missing');
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      if (metadata.referenceId !== reference.id || metadata.language !== language) throw new Error('reference identity mismatch');
      const recipeId = metadata.build?.recipeId;
      const recipe = support.recipes?.[recipeId];
      if (!recipe) throw new Error(`build.recipeId ${recipeId ?? '(missing)'} is not in the pinned SDK registry`);
      if (recipe.language !== language) throw new Error(`recipe ${recipeId} targets ${recipe.language}, not ${language}`);
      if (!Array.isArray(recipe.build?.steps) || !recipe.build.steps.length) throw new Error(`recipe ${recipeId} has no build steps`);
      if (!recipe.build.verification) throw new Error(`recipe ${recipeId} has no component verification step`);
      for (const [position, step] of recipe.build.steps.entries()) run(project, step, `${recipeId}.build[${position}]`);
      run(project, recipe.build.verification, `${recipeId}.verification`);
    } catch (error) {
      failures.push(`${reference.id}/${language}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (failures.length) {
  console.error(`Reference builds failed (${failures.length}); ${executed} recipe steps ran:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${executed} pinned SDK recipe steps completed.`);
}
