import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, 'references', 'reference-index.json'), 'utf8'));
const languageArg = process.argv.find((argument) => argument.startsWith('--language='));
const selectedLanguage = languageArg?.slice('--language='.length);
const allowedLanguages = new Set(['csharp', 'go', 'rust', 'typescript']);
if (selectedLanguage && !allowedLanguages.has(selectedLanguage)) throw new Error(`unsupported language: ${selectedLanguage}`);
const executableAllowlist = new Set(['cargo', 'dotnet', 'go', 'glxdev', 'jco', 'node', 'npm', 'wasmtime']);
const failures = [];
let executed = 0;

for (const reference of index.references.filter((item) => item.kind === 'executable' && item.status !== 'planned')) {
  for (const language of reference.languages) {
    if (selectedLanguage && language !== selectedLanguage) continue;
    const project = resolve(root, 'references', reference.id, language);
    const metadataPath = join(project, 'reference.json');
    if (!existsSync(metadataPath)) { failures.push(`${reference.id}/${language}: reference.json is missing`); continue; }
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (metadata.referenceId !== reference.id || metadata.language !== language) { failures.push(`${reference.id}/${language}: project identity mismatch`); continue; }
    const commands = [...(metadata.build ?? []), ...(metadata.contractChecks ?? [])];
    if (commands.length < 2) { failures.push(`${reference.id}/${language}: build and contract-check commands are required`); continue; }
    for (const step of commands) {
      if (!executableAllowlist.has(step.command) || !Array.isArray(step.args) || step.args.some((arg) => typeof arg !== 'string')) {
        failures.push(`${reference.id}/${language}: unsupported or malformed command ${step.command}`);
        break;
      }
      const cwd = resolve(project, step.cwd ?? '.');
      if (cwd !== project && !cwd.startsWith(`${project}${process.platform === 'win32' ? '\\' : '/'}`)) {
        failures.push(`${reference.id}/${language}: command working directory escapes the project`);
        break;
      }
      const result = spawnSync(step.command, step.args, { cwd, encoding: 'utf8', stdio: 'inherit' });
      executed += 1;
      if (result.error) { failures.push(`${reference.id}/${language}: ${result.command ?? step.command}: ${result.error.message}`); break; }
      if (result.status !== 0) { failures.push(`${reference.id}/${language}: ${step.command} exited ${result.status}`); break; }
    }
  }
}

if (failures.length) {
  console.error(`Reference builds failed (${failures.length}); ${executed} commands ran:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${executed} declared build and contract-check commands completed.`);
}
