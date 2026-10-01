import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const evidenceRoot = resolve(root, 'references', '_shared', 'host-evidence');
const errors = [];
const files = readdirSync(evidenceRoot).filter((name) => name.endsWith('.json')).sort();
const commitPattern = /^[0-9a-f]{40}$/i;
const digestPattern = /^[0-9a-f]{64}$/i;

function inspect(value, file, pointer = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, file, `${pointer}/${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'sha256') && Object.hasOwn(value, 'bytes') && (!Number.isSafeInteger(value.bytes) || value.bytes <= 0)) {
    errors.push(`${file}${pointer}: artifact byte length must be a positive integer`);
  }
  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${key}`;
    if (typeof child === 'string') {
      if ((key === 'sha256' || key.endsWith('Sha256') || key.endsWith('Digest')) && !digestPattern.test(child)) {
        errors.push(`${file}${childPointer}: must be a full SHA-256 digest`);
      }
      if ((key.toLowerCase().includes('commit') || key === 'sourceSnapshot') && !commitPattern.test(child)) {
        errors.push(`${file}${childPointer}: must be a full Git commit SHA`);
      }
      if (['path', 'artifact', 'component', 'golden', 'fixture'].includes(key.toLowerCase()) && (/^(?:[a-z]:[\\/]|\\\\|\/|file:)/i.test(child))) {
        errors.push(`${file}${childPointer}: evidence paths must be repository-relative; absolute machine paths are not portable`);
      }
    }
    if (key === 'production' && child !== false) errors.push(`${file}${childPointer}: fixture evidence cannot claim production qualification`);
    if (key === 'credentialsUsed' && child !== false && value.fixtureOnly === true) errors.push(`${file}${childPointer}: fixture evidence cannot use credentials`);
    inspect(child, file, childPointer);
  }
}

for (const name of files) {
  const file = relative(root, join(evidenceRoot, name)).replaceAll('\\', '/');
  let record;
  try {
    record = JSON.parse(readFileSync(join(evidenceRoot, name), 'utf8'));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (record.schemaVersion !== 1 || typeof record.evidenceId !== 'string') errors.push(`${file}: expected schemaVersion 1 and evidenceId`);
  const source = record.publicSource;
  if (!source || source.repository !== 'glixo-community-references' || !commitPattern.test(source.binarySourceSnapshot ?? '') || !commitPattern.test(source.currentManifestSnapshot ?? '')) {
    errors.push(`${file}: publicSource must name the repository and full binary/current-manifest source commits`);
  }
  const runtime = record.runtime ?? record.host;
  if (!runtime || !commitPattern.test(runtime.sourceCommit ?? '') || !digestPattern.test(runtime.sha256 ?? '') || runtime.protocolVersion !== 2) {
    errors.push(`${file}: missing exact protocol-2 runtime source and binary identity`);
  }
  const fixture = record.scopes?.framedFixture;
  if (!fixture || fixture.result !== 'passed' || fixture.credentialsUsed !== false || fixture.externalNetworkUsed !== false || fixture.production !== false || fixture.persisted !== false) {
    errors.push(`${file}: framed fixture scope must explicitly pass without credentials, external network, production, or persistence`);
  }
  if (record.driver && (!commitPattern.test(record.driver.sourceCommit ?? '') || !digestPattern.test(record.driver.sha256 ?? ''))) {
    errors.push(`${file}: driver identity must include full source commit and SHA-256`);
  }
  if (record.evidenceId === 'ollama-provider-protocol2-framed-conformance') {
    const live = record.scopes?.realOllama;
    const scope = live?.httpConnectionScope;
    if (live?.status !== 'passed-local-backend' || live.installedExtensionLifecycle !== false || live.productionApprovalFlowTested !== false) {
      errors.push(`${file}: local Ollama success must remain distinct from installed lifecycle and production approval`);
    }
    if (!scope || JSON.stringify(scope.endpoints) !== '["ollama"]' || JSON.stringify(scope.methods) !== '["GET","POST"]' || JSON.stringify(scope.paths) !== '["/api/tags","/api/show","/api/chat"]') {
      errors.push(`${file}: live local Ollama record must contain the canonical endpoint/method/path scope`);
    }
    for (const [language, artifact] of Object.entries(record.languages ?? {})) {
      if (live?.languages?.[language]?.sha256 !== artifact.sha256) errors.push(`${file}: live and framed artifact digest differs for ${language}`);
    }
  }
  if (record.evidenceId === 'mail-watch-installed-scheduler-protocol2') {
    const installed = record.scopes?.installedScheduler;
    const framedTypeScript = record.scopes?.framedFixture?.languages?.typescript;
    if (installed?.result !== 'passed' || installed.persisted !== true || installed.fixtureOnly !== true || installed.language !== 'typescript') {
      errors.push(`${file}: installed Mail Watch qualification must remain a persisted TypeScript fixture result`);
    }
    if (framedTypeScript?.sha256 !== record.artifact?.sha256) errors.push(`${file}: installed and framed Mail Watch TypeScript component digests differ`);
    if (record.scopes?.liveGraph?.status !== 'not-tested') errors.push(`${file}: Mail Watch fixture results must not imply live Graph acceptance`);
  }
  inspect(record, file);
}

if (files.length === 0) errors.push('host-evidence directory contains no evidence records');
if (errors.length) {
  console.error(`Host evidence verification failed (${errors.length}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${files.length} portable host evidence record(s), including runtime, driver, artifact, and qualification boundaries.`);
}
