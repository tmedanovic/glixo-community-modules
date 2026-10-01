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
const permissionsPath = join(root, 'packages', 'extension-sdk', 'wit', 'manifest', 'permissions.json');
if (!existsSync(permissionsPath)) throw new Error(`canonical permission catalog is missing: ${permissionsPath}`);
const permissionCatalog = JSON.parse(readFileSync(permissionsPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false });
const validate = ajv.compile(schema);
const errors = [];
let checked = 0;
let checkedSchemas = 0;

const hostConfigurationSchemaKeys = new Set([
  'type', 'properties', 'required', 'enum', 'default', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'format', 'description', 'if', 'then',
  'additionalProperties', 'const', 'x-secret', 'x-oauth', 'x-ui', 'items',
  'minItems', 'maxItems',
]);

function validateHostConfigurationSchema(data, label) {
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > 65536) errors.push(`${label}: configuration schema exceeds the host 64 KiB bound`);

  function visit(node, path, depth, isPropertySchema, topLevelProperty) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      errors.push(`${label}${path}: configuration schema node must be an object`);
      return;
    }
    if (depth > 16) errors.push(`${label}${path}: configuration schema exceeds the host depth 16 bound`);
    for (const key of Object.keys(node)) {
      if (!hostConfigurationSchemaKeys.has(key)) errors.push(`${label}${path}/${key}: unsupported host configuration schema keyword`);
    }
    if ((Object.hasOwn(node, 'x-secret') || Object.hasOwn(node, 'x-oauth')) && !(isPropertySchema && topLevelProperty)) {
      errors.push(`${label}${path}: x-secret and x-oauth are allowed only on top-level property schemas`);
    }
    if (node.type === 'array') {
      if (!Object.hasOwn(node, 'items') || !node.items || typeof node.items !== 'object' || Array.isArray(node.items)) {
        errors.push(`${label}${path}: array schema must declare an object items schema`);
      }
      if (!Number.isInteger(node.maxItems) || node.maxItems < 0 || node.maxItems > 64) {
        errors.push(`${label}${path}: array schema maxItems must be an integer from 0 through 64`);
      }
      if (node.minItems !== undefined && (!Number.isInteger(node.minItems) || node.minItems < 0 || node.minItems > node.maxItems)) {
        errors.push(`${label}${path}: array schema minItems must be from 0 through maxItems`);
      }
    }
    if (node.properties !== undefined) {
      if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
        errors.push(`${label}${path}/properties: must be an object`);
      } else {
        for (const [name, child] of Object.entries(node.properties)) visit(child, `${path}/properties/${name}`, depth + 1, true, depth === 0);
      }
    }
    if (node.required !== undefined && (!Array.isArray(node.required) || node.required.some((name) => typeof name !== 'string'))) {
      errors.push(`${label}${path}/required: must be an array of property names`);
    }
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) visit(node.items, `${path}/items`, depth + 1, false, false);
    if (node.additionalProperties && typeof node.additionalProperties === 'object') visit(node.additionalProperties, `${path}/additionalProperties`, depth + 1, false, false);
    if (node.if && typeof node.if === 'object') visit(node.if, `${path}/if`, depth + 1, false, false);
    if (node.then && typeof node.then === 'object') visit(node.then, `${path}/then`, depth + 1, false, false);
  }

  visit(data, '', 0, false, false);
}

function validatePermissionRequests(manifest, label) {
  const catalog = new Map(permissionCatalog.permissions.map((permission) => [permission.id, permission]));
  for (const requested of manifest.permissions?.requested ?? []) {
    const permission = catalog.get(requested.id);
    if (!permission) {
      errors.push(`${label}/permissions/requested/${requested.id}: permission is absent from the canonical catalog`);
      continue;
    }
    const scopeSchema = permissionCatalog.scopeSchemas[permission.scopeSchema];
    if (!scopeSchema) {
      errors.push(`${label}/permissions/requested/${requested.id}: canonical scope schema ${permission.scopeSchema} is missing`);
      continue;
    }
    try {
      const validateScope = ajv.compile(scopeSchema);
      if (!validateScope(requested.scope ?? {})) {
        for (const error of validateScope.errors ?? []) errors.push(`${label}/permissions/requested/${requested.id}/scope${error.instancePath || '/'}: ${error.message}`);
      }
    } catch (error) {
      errors.push(`${label}/permissions/requested/${requested.id}: invalid canonical scope schema (${error instanceof Error ? error.message : String(error)})`);
    }
  }
}

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
    return null;
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
    return digest;
  }
  if (label.includes('/configuration/')) {
    for (const unsupported of ['$schema', 'title']) {
      if (Object.hasOwn(data, unsupported)) errors.push(`${label}: configuration schema uses unsupported top-level ${unsupported}`);
    }
    validateHostConfigurationSchema(data, label);
  }
  try {
    ajv.compile(data);
  } catch (error) {
    errors.push(`${label}: invalid JSON Schema (${error instanceof Error ? error.message : String(error)})`);
  }
  checkedSchemas += 1;
  return digest;
}

function requireFamilyDigest(digests, key, digest, label) {
  if (!digest) return;
  const previous = digests.get(key);
  if (previous && previous.digest !== digest) {
    errors.push(`${label}: schema bytes differ across language templates (${previous.label}: ${previous.digest}, current: ${digest})`);
  } else {
    digests.set(key, { digest, label });
  }
}

for (const reference of index.references) {
  if (reference.kind !== 'executable') continue;
  const configurationDigests = new Map();
  const eventDigests = new Map();
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
    validatePermissionRequests(manifest, `${reference.id}/${language}`);

    for (const configuration of manifest.configurations ?? []) {
      const digest = validateDeclaredSchema(
        reference,
        language,
        projectRoot,
        configuration.schema,
        `${reference.id}/${language}/configuration/${configuration.id}`,
        configuration.schemaDigest,
      );
      requireFamilyDigest(configurationDigests, configuration.id, digest, `${reference.id}/${language}/configuration/${configuration.id}`);
    }
    for (const event of manifest.events?.publish ?? []) {
      if (event.schema) {
        const digest = validateDeclaredSchema(
          reference,
          language,
          projectRoot,
          event.schema,
          `${reference.id}/${language}/event/${event.type}@${event.schemaVersion}`,
        );
        requireFamilyDigest(eventDigests, `${event.type}@${event.schemaVersion}`, digest, `${reference.id}/${language}/event/${event.type}@${event.schemaVersion}`);
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
