import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, globSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, 'references', 'reference-index.json'), 'utf8'));
const support = JSON.parse(readFileSync(join(root, 'packages', 'extension-sdk', 'support-matrix.json'), 'utf8'));
const languageArg = process.argv.find((argument) => argument.startsWith('--language='));
const selectedLanguage = languageArg?.slice('--language='.length);
const referenceArg = process.argv.find((argument) => argument.startsWith('--reference='));
const selectedReference = referenceArg?.slice('--reference='.length);
const exportArgIndex = process.argv.findIndex((argument) => argument === '--export-dir' || argument.startsWith('--export-dir='));
const exportDirArg = exportArgIndex < 0 ? undefined
  : process.argv[exportArgIndex] === '--export-dir' ? process.argv[exportArgIndex + 1]
    : process.argv[exportArgIndex].slice('--export-dir='.length);
if (exportArgIndex >= 0 && (!exportDirArg || exportDirArg.startsWith('--'))) throw new Error('--export-dir requires a directory path');
const exportDirectory = exportDirArg ? resolve(root, exportDirArg) : undefined;
const allowedLanguages = new Set(['csharp', 'go', 'rust', 'typescript']);
const allowedTools = new Set(['cargo', 'componentize-go', 'dotnet', 'go', 'node', 'npm', 'wasm-tools']);
if (selectedLanguage && !allowedLanguages.has(selectedLanguage)) throw new Error(`unsupported language: ${selectedLanguage}`);
if (selectedReference && !index.references.some((item) => item.id === selectedReference && item.kind === 'executable' && item.status !== 'planned')) {
  throw new Error(`unknown or non-buildable reference: ${selectedReference}`);
}
const failures = [];
let executed = 0;
const exportedComponents = [];

function gitValue(args, label) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: git exited ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function captureSourceIdentity() {
  const dirty = gitValue(['status', '--porcelain', '--untracked-files=all'], 'checking source worktree');
  if (dirty) throw new Error('artifact export requires a clean source worktree');
  return {
    repository: 'https://github.com/tmedanovic/glixo-community-modules',
    commit: gitValue(['rev-parse', 'HEAD^{commit}'], 'resolving source commit'),
    tree: gitValue(['rev-parse', 'HEAD^{tree}'], 'resolving source tree'),
  };
}

function prepareExportDirectory(directory) {
  if (directory === root || directory.startsWith(`${root}${sep}`)) {
    throw new Error('artifact export directory must be outside the source checkout');
  }
  if (existsSync(directory)) {
    if (!statSync(directory).isDirectory()) throw new Error('artifact export path exists and is not a directory');
    if (readdirSync(directory).length) throw new Error('artifact export directory must be empty');
  } else {
    mkdirSync(directory, { recursive: true });
  }
}

function safePathSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} is not a safe artifact path segment`);
  }
  return value;
}

function exportVerifiedComponents(project, projectManifest, recipeId, reference, language) {
  safePathSegment(reference.id, 'reference id');
  const components = projectManifest.components;
  if (!Array.isArray(components) || !components.length) throw new Error('glixo.project.json has no components to export');
  const componentIds = new Set();
  for (const component of components) {
    const componentId = safePathSegment(component.id, 'component id');
    if (componentIds.has(componentId)) throw new Error(`duplicate component id ${componentId}`);
    componentIds.add(componentId);
    if (component.language && component.language !== language) throw new Error(`${componentId} language does not match ${language}`);
    if (component.recipe !== recipeId) throw new Error(`${componentId} recipe does not match ${recipeId}`);
    const verifiedArtifact = projectManifestArtifact(recipeId);
    if (component.artifact && component.artifact !== verifiedArtifact) {
      throw new Error(`${componentId}: declared artifact does not match the verified recipe output`);
    }
    const artifactPath = component.artifact ?? verifiedArtifact;
    const sourcePath = insideProject(project, artifactPath, `${componentId}.artifact`);
    const sourceStat = lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`${componentId}: verified artifact is not a regular file`);
    const fileName = sourcePath.slice(sourcePath.lastIndexOf(sep) + 1);
    if (!fileName.endsWith('.wasm')) throw new Error(`${componentId}: artifact must be a WASM component`);
    const relativeArtifact = join('components', reference.id, language, componentId, fileName);
    const destination = resolve(exportDirectory, relativeArtifact);
    if (!destination.startsWith(`${exportDirectory}${sep}`)) throw new Error('artifact path escapes export directory');
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);
    const bytes = readFileSync(destination);
    exportedComponents.push({
      referenceId: reference.id,
      componentId,
      language,
      recipeId,
      sourceArtifact: artifactPath.replaceAll('\\', '/'),
      artifact: relativeArtifact.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
}

function projectManifestArtifact(recipeId) {
  const recipe = support.recipes?.[recipeId];
  const output = recipe?.build?.verification?.output;
  if (typeof output !== 'string') throw new Error(`${recipeId}: verification must declare the component output`);
  return output;
}

if (exportDirectory && !selectedLanguage) throw new Error('--export-dir requires --language so each receipt covers one language');
const sourceIdentity = exportDirectory ? captureSourceIdentity() : undefined;
if (exportDirectory) prepareExportDirectory(exportDirectory);

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
  const ignored = new Set(['.git', 'node_modules', 'bin', 'obj', 'target', 'dist', 'vendor', '.glixo-sdk']);
  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      const parts = path.split(/[\\/]/);
      return !parts.some((part) => ignored.has(part));
    },
  });
}

function copyTrackedTree(source, destination) {
  const repositoryPath = relative(root, source).replaceAll('\\', '/');
  const tracked = gitValue(['ls-files', '--cached', '--full-name', '--', repositoryPath], `listing tracked files for ${repositoryPath}`)
    .split(/\r?\n/).filter(Boolean);
  if (!tracked.length) throw new Error(`${repositoryPath}: no tracked source files`);
  mkdirSync(destination, { recursive: true });
  for (const entry of tracked) {
    if (!entry.startsWith(`${repositoryPath}/`)) throw new Error(`tracked source path escaped ${repositoryPath}`);
    const sourceFile = resolve(root, entry);
    const destinationFile = resolve(destination, entry.slice(repositoryPath.length + 1));
    if (!destinationFile.startsWith(`${destination}${sep}`)) throw new Error('tracked source file escaped temporary project');
    const info = lstatSync(sourceFile);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`tracked source is not a regular file: ${entry}`);
    mkdirSync(dirname(destinationFile), { recursive: true });
    copyFileSync(sourceFile, destinationFile);
  }
}

function vendorSdk(project, reference, language) {
  const sdkPath = support.languages?.[language]?.sdkPath;
  if (!sdkPath || typeof sdkPath !== 'string' || isAbsolute(sdkPath) || sdkPath.split(/[\\/]/).includes('..')) return;
  const sourceSdk = resolve(root, sdkPath);
  if (!existsSync(sourceSdk)) throw new Error(`${reference.id}/${language}: public SDK source is missing: ${sdkPath}`);
  // Go treats any vendor/ directory as module vendoring and rejects our SDK source copy.
  const sdkDirectory = language === 'go' ? '.glixo-sdk' : 'vendor';
  const vendorPath = join(project, sdkDirectory, 'glixo-extension-sdk');
  mkdirSync(join(project, sdkDirectory), { recursive: true });
  copyTree(sourceSdk, vendorPath);

  function rewrite(directory) {
    for (const name of readdirSync(directory)) {
      if (['.git', 'node_modules', 'bin', 'obj', 'target', 'dist', 'vendor', '.glixo-sdk'].includes(name)) continue;
      const path = join(directory, name);
      const info = statSync(path);
      if (info.isDirectory()) { rewrite(path); continue; }
      if (!['.json', '.toml', '.mod', '.csproj'].includes(name.slice(name.lastIndexOf('.')))) continue;
      let source = readFileSync(path, 'utf8');
      if (language === 'typescript') {
        source = source.replace(/file:(?:\.\.\/)+packages\/extension-sdk\/typescript/g, 'file:vendor/glixo-extension-sdk');
        source = source.replace(/(?:\.\.\/)+packages\/extension-sdk\/typescript/g, 'vendor/glixo-extension-sdk');
      } else if (language === 'go') {
        source = source.replace(/=>\s*(?:\.\.\/)+packages\/extension-sdk\/go/g, '=> ./.glixo-sdk/glixo-extension-sdk');
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

for (const reference of index.references.filter((item) => item.kind === 'executable' && item.status !== 'planned'
  && (!selectedReference || item.id === selectedReference))) {
  for (const language of reference.languages) {
    if (selectedLanguage && language !== selectedLanguage) continue;
    const sourceProject = resolve(root, 'references', reference.id, language);
    const buildRoot = mkdtempSync(join(tmpdir(), 'glixo-reference-build-'));
    const project = join(buildRoot, 'project');
    const metadataPath = join(project, 'reference.json');
    try {
      if (!existsSync(sourceProject)) throw new Error('project directory is missing');
      if (exportDirectory) copyTrackedTree(sourceProject, project);
      else copyTree(sourceProject, project);
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
      if (exportDirectory) {
        const projectManifestPath = join(project, 'glixo.project.json');
        if (!existsSync(projectManifestPath)) throw new Error('glixo.project.json is missing; verified component export requires declared component identities');
        const projectManifest = JSON.parse(readFileSync(projectManifestPath, 'utf8'));
        if (projectManifest.schemaVersion !== 1 || projectManifest.language !== language) {
          throw new Error('glixo.project.json schema or language does not match the build');
        }
        exportVerifiedComponents(project, projectManifest, recipeId, reference, language);
      }
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
  if (exportDirectory) {
    const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    exportedComponents.sort((left, right) => compare(left.referenceId, right.referenceId) || compare(left.componentId, right.componentId));
    const finalIdentity = captureSourceIdentity();
    if (finalIdentity.commit !== sourceIdentity.commit || finalIdentity.tree !== sourceIdentity.tree) {
      throw new Error('source identity changed during artifact builds');
    }
    const receipt = { schemaVersion: 1, source: sourceIdentity, language: selectedLanguage, components: exportedComponents };
    writeFileSync(join(exportDirectory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(`${executed} pinned SDK recipe steps completed; exported ${exportedComponents.length} verified components from ${sourceIdentity.commit}.`);
  } else {
    console.log(`${executed} pinned SDK recipe steps completed.`);
  }
}
