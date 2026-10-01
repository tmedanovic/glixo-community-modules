import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, globSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  const windowsNpmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const executable = process.platform === 'win32' && step.tool === 'npm' ? process.execPath : step.tool;
  const args = executable === process.execPath && step.tool === 'npm' && process.platform === 'win32'
    ? [windowsNpmCli, ...step.args]
    : step.args;
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: 'inherit', shell: false });
  executed += 1;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: ${step.tool} exited ${result.status}`);
  if (step.output) {
    insideProject(project, step.output, `${label}.output`);
    const matches = globSync(step.output, { cwd: project });
    if (!matches.length) throw new Error(`${label}: expected output ${step.output} was not created`);
  }
}

function copyTree(source, destination) {
  const ignored = new Set(['.git', 'node_modules', 'bin', 'obj', 'target', 'dist', 'vendor']);
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      const parts = path.split(/[\\/]/);
      return !parts.some((part) => ignored.has(part));
    },
  });
}

function vendorSdk(project, reference, language) {
  const sdkPath = support.languages?.[language]?.sdkPath;
  if (!sdkPath || typeof sdkPath !== 'string' || isAbsolute(sdkPath) || sdkPath.split(/[\\/]/).includes('..')) return;
  const sourceSdk = resolve(root, sdkPath);
  if (!existsSync(sourceSdk)) throw new Error(`${reference.id}/${language}: public SDK source is missing: ${sdkPath}`);
  const vendorPath = join(project, 'vendor', 'glixo-extension-sdk');
  mkdirSync(join(project, 'vendor'), { recursive: true });
  copyTree(sourceSdk, vendorPath);

  function rewrite(directory) {
    for (const name of readdirSync(directory)) {
      if (['.git', 'node_modules', 'bin', 'obj', 'target', 'dist', 'vendor'].includes(name)) continue;
      const path = join(directory, name);
      const info = statSync(path);
      if (info.isDirectory()) { rewrite(path); continue; }
      if (!['.json', '.toml', '.mod', '.csproj'].includes(name.slice(name.lastIndexOf('.')))) continue;
      let source = readFileSync(path, 'utf8');
      if (language === 'typescript') {
        source = source.replace(/file:(?:\.\.\/)+packages\/extension-sdk\/typescript/g, 'file:vendor/glixo-extension-sdk');
        source = source.replace(/(?:\.\.\/)+packages\/extension-sdk\/typescript/g, 'vendor/glixo-extension-sdk');
      } else if (language === 'go') {
        source = source.replace(/=>\s*(?:\.\.\/)+packages\/extension-sdk\/go/g, '=> ./vendor/glixo-extension-sdk');
      } else if (language === 'rust') {
        source = source.replace(/path\s*=\s*"(?:\.\.\/)+packages\/extension-sdk\/rust"/g, 'path = "vendor/glixo-extension-sdk"');
      } else if (language === 'csharp' && name.endsWith('.csproj')) {
        const sdkProject = join(vendorPath, 'Glixo.ExtensionSdk', 'Glixo.ExtensionSdk.csproj');
        const relativeSdkProject = relative(dirname(path), sdkProject).replaceAll('\\', '/');
        source = source.replace(/Include="[^"]*packages\/extension-sdk\/csharp\/Glixo\.ExtensionSdk\/Glixo\.ExtensionSdk\.csproj"/g, `Include="${relativeSdkProject}"`);
      }
      if (source !== readFileSync(path, 'utf8')) writeFileSync(path, source);
    }
  }

  rewrite(project);
}

for (const reference of index.references.filter((item) => item.kind === 'executable' && item.status !== 'planned')) {
  for (const language of reference.languages) {
    if (selectedLanguage && language !== selectedLanguage) continue;
    const sourceProject = resolve(root, 'references', reference.id, language);
    const buildRoot = mkdtempSync(join(tmpdir(), 'glixo-reference-build-'));
    const project = join(buildRoot, 'project');
    const metadataPath = join(project, 'reference.json');
    try {
      if (!existsSync(sourceProject)) throw new Error('project directory is missing');
      copyTree(sourceProject, project);
      vendorSdk(project, reference, language);
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
    } finally {
      rmSync(buildRoot, { recursive: true, force: true });
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
