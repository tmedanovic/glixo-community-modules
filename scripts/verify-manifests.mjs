import Ajv2020 from 'ajv/dist/2020.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const index = JSON.parse(readFileSync(join(root, 'references', 'reference-index.json'), 'utf8'));
const schemaPath = join(root, 'packages', 'extension-sdk', 'wit', 'manifest', 'extension-manifest-v2.schema.json');
if (!existsSync(schemaPath)) throw new Error(`canonical v2 manifest schema is missing: ${schemaPath}`);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const errors = [];
let checked = 0;

for (const reference of index.references) {
  if (reference.kind !== 'executable') continue;
  for (const language of reference.languages) {
    const manifestPath = join(root, 'references', reference.id, language, 'glixo.extension.json');
    if (!existsSync(manifestPath)) continue; // planned language path; reference-index verification reports source status.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Validate the template against the published schema using legal scaffold substitutions.
    manifest.id = 'org.glixo.reference';
    if (manifest.metadata?.name === '{{NAME}}') manifest.metadata.name = 'Reference Fixture';
    checked += 1;
    if (!validate(manifest)) {
      for (const error of validate.errors ?? []) errors.push(`${reference.id}/${language}${error.instancePath || '/'}: ${error.message}`);
    }
  }
}

if (errors.length) {
  console.error(`Manifest validation failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${checked} v2 guest manifest template(s) against the pinned canonical schema.`);
}
