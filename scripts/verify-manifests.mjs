import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, 'references', 'reference-index.json'), 'utf8'));
const schemaPath = join(root, 'packages', 'extension-sdk', 'wit', 'manifest', 'extension-manifest-v2.schema.json');
if (!existsSync(schemaPath)) throw new Error(`canonical v2 manifest schema is missing: ${schemaPath}`);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false });
const validate = ajv.compile(schema);
const errors = [];
let checked = 0;
let checkedSchemas = 0;

function safeProjectPath(projectRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
    errors.push(`${label}: schema path must be a non-empty relative path`);
    return null;
  }
  const path = resolve(projectRoot, relativePath);
  if (path !== projectRoot && !path.startsWith(`${projectRoot}${sep}`)) {
    errors.push(`${label}: schema path escapes the project`);
    return null;
  }
  return path;
}

function validateDeclaredSchema(reference, language, projectRoot, relativePath, label, expectedDigest) {
  const projectSchemaPath = safeProjectPath(projectRoot, relativePath, label);
  const shared = reference.scaffold?.sharedPaths?.find((item) => item.destination === relativePath);
  const sharedSchemaPath = shared ? resolve(root, shared.sourcePath) : null;
  const selectedPath = projectSchemaPath && existsSync(projectSchemaPath)
    ? projectSchemaPath
    : sharedSchemaPath;

  if (!selectedPath || !existsSync(selectedPath)) {
    errors.push(`${label}: declared schema file is missing (${relativePath})`);
    return;
  }

  const bytes = readFileSync(selectedPath);
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (sharedSchemaPath && existsSync(sharedSchemaPath) && selectedPath !== sharedSchemaPath) {
    const sharedBytes = readFileSync(sharedSchemaPath);
    const sharedDigest = `sha256:${createHash('sha256').update(sharedBytes).digest('hex')}`;
    if (digest !== sharedDigest) errors.push(`${label}: project schema differs from shared mapped source ${shared.sourcePath}`);
  }
  if (expectedDigest && digest !== expectedDigest) {
    errors.push(`${label}: schemaDigest mismatch (manifest ${expectedDigest}, file ${digest})`);
  }

  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    errors.push(`${label}: schema is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  if (label.includes('/configuration/')) {
    for (const unsupported of ['$schema', 'title']) {
      if (Object.hasOwn(data, unsupported)) errors.push(`${label}: configuration schema uses unsupported top-level ${unsupported}`);
    }
  }
  try {
    ajv.compile(data);
  } catch (error) {
    errors.push(`${label}: invalid JSON Schema (${error instanceof Error ? error.message : String(error)})`);
  }
  checkedSchemas += 1;
}

for (const reference of index.references) {
  if (reference.kind !== 'executable') continue;
  for (const language of reference.languages) {
    const projectRoot = resolve(root, 'references', reference.id, language);
    const manifestPath = join(projectRoot, 'glixo.extension.json');
    if (!existsSync(manifestPath)) continue; // planned language path; reference-index verification reports source status.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Validate the template against the published schema using legal scaffold substitutions.
    manifest.id = 'org.glixo.reference';
    if (manifest.metadata?.name === '{{NAME}}') manifest.metadata.name = 'Reference Fixture';
    checked += 1;
    if (!validate(manifest)) {
      for (const error of validate.errors ?? []) errors.push(`${reference.id}/${language}${error.instancePath || '/'}: ${error.message}`);
    }

    for (const configuration of manifest.configurations ?? []) {
      validateDeclaredSchema(
        reference,
        language,
        projectRoot,
        configuration.schema,
        `${reference.id}/${language}/configuration/${configuration.id}`,
        configuration.schemaDigest,
      );
    }
    for (const event of manifest.events?.publish ?? []) {
      if (event.schema) {
        validateDeclaredSchema(
          reference,
          language,
          projectRoot,
          event.schema,
          `${reference.id}/${language}/event/${event.type}@${event.schemaVersion}`,
        );
      }
    }
  }
}

if (errors.length) {
  console.error(`Manifest validation failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${checked} v2 guest manifest template(s) and ${checkedSchemas} declared configuration/event schema file(s), including shared-source digests.`);
}
