// Structural check for the independent Rust v3 host-conformance source that a
// reference may declare under `qualification` in references/reference-index.json.
//
// This is a path, file-type, metadata and pin check only. It does not parse TOML
// or Rust, and it does not prove that the crate compiles, that the component
// links, that a generated export exists, or that a host grants the permissions
// it exercises. Those stay with the parent's `cargo build --locked`, wasm-tools
// and installed-host gates. The one lexical step (`maskNonCode`) only keeps
// comments and string text from standing in for a declaration.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export const RUST_SECRET_HTTP_V3 = Object.freeze({
  directory: 'rust-secret-http-v3',
  library: 'rust_secret_http_v3_conformance',
  target: 'wasm32-wasip2',
  world: 'provider-compat',
  sdkPath: 'packages/extension-sdk/rust',
  recipeWorld: 'glixo:llm-provider-compat/provider-compat@3.0.0',
  wit: Object.freeze({
    http: 'glixo:http@3.0.0',
    llmTypes: 'glixo:llm-types@3.0.0',
    providerWorld: 'glixo:llm-provider-compat@3.0.0',
  }),
});

const declarationKeys = ['rustSecretHttpV3SourcePath', 'rustSecretHttpV3Library', 'rustSecretHttpV3Target'];
const knownKeys = new Set([...declarationKeys, 'purpose']);
const scaffoldMarkers = new Set(['glixo.extension.json', 'glixo.project.json', 'reference.json']);
const authorLanguages = ['csharp', 'go', 'rust', 'typescript'];
const authorBuildFiles = ['glixo.project.json', 'glixo.extension.json', 'reference.json', 'Cargo.toml', 'go.mod', 'package.json'];
const maxTextBytes = 1024 * 1024;
const maxTreeEntries = 256;
const maxTreeDepth = 8;
const maxRawStringHashes = 255;
const maxEscapedCharLiteral = 14;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function expectedSourcePath(referenceId) {
  return `references/${referenceId}/qualification/${RUST_SECRET_HTTP_V3.directory}`;
}

// Returns a reason string when `value` is not the one allowed source path.
function sourcePathProblem(value, referenceId) {
  if (typeof value !== 'string' || !value) return 'must be a non-empty string';
  if (/[\u0000-\u001f]/.test(value)) return 'must not contain control characters';
  if (value.includes('\\')) return 'must use forward slashes only';
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return 'must be repository-relative, not absolute';
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return 'must not contain empty, "." or ".." segments';
  const subtree = `references/${referenceId}/qualification/`;
  if (!value.startsWith(subtree)) return `must stay inside ${subtree}`;
  const expected = expectedSourcePath(referenceId);
  if (value !== expected) return `must be exactly ${expected}`;
  return undefined;
}

// Walks `relPath` one component at a time so that a link or wrong-type entry in
// any ancestor is reported, not only in the final file. Names are also matched
// case-exactly against the directory listing, so a case-insensitive filesystem
// cannot satisfy a lookup that Linux CI would miss.
function inspect(root, relPath, expected) {
  const parts = relPath.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index + 1).join('/');
    const parent = current;
    current = join(current, parts[index]);
    let info;
    try {
      if (!readdirSync(parent).includes(parts[index])) return { problem: `${prefix} is missing (names are case-exact)` };
      info = lstatSync(current);
    } catch (error) {
      return { problem: error?.code === 'ENOENT' ? `${prefix} is missing` : `${prefix} cannot be inspected (${error?.code ?? 'error'})` };
    }
    if (info.isSymbolicLink()) return { problem: `${prefix} is a symbolic link or junction` };
    const last = index === parts.length - 1;
    if (!last || expected === 'directory') {
      if (!info.isDirectory()) return { problem: `${prefix} must be a directory` };
    } else if (!info.isFile()) {
      return { problem: `${prefix} must be a regular file` };
    }
    if (last) return { info, path: current };
  }
  return { problem: `${relPath} is empty` };
}

function readText(root, relPath, errors, label) {
  const found = inspect(root, relPath, 'file');
  if (found.problem) { errors.push(`${label}: ${found.problem}`); return undefined; }
  if (found.info.size === 0) { errors.push(`${label}: ${relPath} is empty`); return undefined; }
  if (found.info.size > maxTextBytes) { errors.push(`${label}: ${relPath} is larger than the ${maxTextBytes} byte structural-check bound`); return undefined; }
  return readFileSync(found.path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function isIdentifierUnit(code) {
  return code === 95 || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code >= 128;
}

// Returns the index just past a `'x'` / `'\n'` literal that starts at `start`,
// `start + 1` when the tick is a lifetime or label, or -1 for a malformed escape.
function charLiteralEnd(text, start) {
  if (text[start + 1] === '\\') {
    const limit = Math.min(text.length, start + maxEscapedCharLiteral + 1);
    for (let index = start + 3; index < limit && text[index] !== '\n'; index += 1) {
      if (text[index] === "'") return index + 1;
    }
    return -1;
  }
  const first = text[start + 1];
  if (first === undefined || first === "'" || first === '\n') return start + 1;
  const width = text.codePointAt(start + 1) > 0xffff ? 2 : 1;
  return text[start + 1 + width] === "'" ? start + 2 + width : start + 1;
}

// Bounded lexical pass for the declaration checks. It blanks comments (and, with
// `literals`, the body of "\u2026", r#"\u2026"# and 'x' literals) so declaration-looking
// text inside them cannot satisfy a line-anchored pattern. `masked` has the same
// length and line breaks as `text`, so a match offset found in it indexes the
// original text; that is how macro argument strings are read back unchanged.
// It knows `//` comments, nested `/* */` comments and those literal forms, and
// nothing else: it is not a Rust or WIT parser. Unterminated forms are reported
// as `problem` instead of being guessed at.
function maskNonCode(text, { literals }) {
  const out = text.split('');
  const blank = (from, to, fill) => {
    for (let index = from; index < to; index += 1) if (text[index] !== '\n') out[index] = fill;
  };
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index);
      const end = newline === -1 ? text.length : newline;
      blank(index, end, ' ');
      index = end;
    } else if (char === '/' && text[index + 1] === '*') {
      let depth = 1;
      let end = index + 2;
      while (end < text.length && depth > 0) {
        if (text[end] === '/' && text[end + 1] === '*') { depth += 1; end += 2; }
        else if (text[end] === '*' && text[end + 1] === '/') { depth -= 1; end += 2; }
        else end += 1;
      }
      if (depth > 0) return { problem: `has an unterminated block comment opened at line ${lineOf(index)}` };
      blank(index, end, ' ');
      index = end;
    } else if (!literals) {
      index += 1;
    } else if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (end >= text.length) return { problem: `has an unterminated string literal opened at line ${lineOf(index)}` };
      blank(index + 1, end, '_');
      index = end + 1;
    } else if (char === "'") {
      const end = charLiteralEnd(text, index);
      if (end === -1) return { problem: `has a malformed character literal at line ${lineOf(index)}` };
      if (end > index + 1) blank(index + 1, end - 1, '_');
      index = end;
    } else if (isIdentifierUnit(text.charCodeAt(index))) {
      let end = index + 1;
      while (end < text.length && isIdentifierUnit(text.charCodeAt(end))) end += 1;
      const word = text.slice(index, end);
      index = end;
      if (word === 'r' || word === 'br' || word === 'cr') {
        let hashes = 0;
        while (text[index + hashes] === '#') hashes += 1;
        if (text[index + hashes] === '"') {
          if (hashes > maxRawStringHashes) return { problem: `has a raw string literal with more than ${maxRawStringHashes} # characters at line ${lineOf(index)}` };
          const bodyStart = index + hashes + 1;
          const close = text.indexOf(`"${'#'.repeat(hashes)}`, bodyStart);
          if (close === -1) return { problem: `has an unterminated raw string literal opened at line ${lineOf(index)}` };
          blank(bodyStart, close, '_');
          index = close + 1 + hashes;
        }
      }
    } else {
      index += 1;
    }
  }
  return { masked: out.join('') };
}

// Line-oriented reader for the narrow Cargo.toml shapes this crate uses:
// `[table]` headers and one-line `key = value` pairs. Anything else is kept as
// `unsupported` so callers fail closed instead of guessing.
function parseValue(raw) {
  let match = /^"([^"\\]*)"\s*(?:#.*)?$/.exec(raw);
  if (match) return { string: match[1] };
  match = /^\[((?:\s*"[^"\\]*"\s*,?)*)\s*\]\s*(?:#.*)?$/.exec(raw);
  if (match) return { list: [...match[1].matchAll(/"([^"\\]*)"/g)].map((entry) => entry[1]) };
  match = /^\{\s*path\s*=\s*"([^"\\]*)"\s*\}\s*(?:#.*)?$/.exec(raw);
  if (match) return { path: match[1] };
  return { unsupported: raw };
}

function readCargoTables(text) {
  const tables = new Map();
  let current;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/.exec(line);
    if (header) {
      const table = tables.get(header[1]) ?? { count: 0, values: new Map(), duplicates: new Set() };
      table.count += 1;
      tables.set(header[1], table);
      current = table;
      continue;
    }
    if (line.startsWith('[')) { current = undefined; continue; }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair || !current) continue;
    if (current.values.has(pair[1])) current.duplicates.add(pair[1]);
    current.values.set(pair[1], parseValue(pair[2].trim()));
  }
  return tables;
}

function stringValue(table, key) {
  const value = table?.values.get(key);
  return typeof value?.string === 'string' ? value.string : undefined;
}

function checkSupport(support, errors, label) {
  if (!isPlainObject(support)) { errors.push(`${label}: the public SDK support matrix is required to check qualification dependencies`); return undefined; }
  const wanted = RUST_SECRET_HTTP_V3;
  const rust = support.languages?.rust;
  if (rust?.sdkPath !== wanted.sdkPath) errors.push(`${label}: support matrix rust.sdkPath must be ${wanted.sdkPath}`);
  if (support.toolchains?.rust?.target !== wanted.target) errors.push(`${label}: support matrix rust toolchain target must be ${wanted.target}`);
  const witBindgen = support.toolchains?.rust?.witBindgen?.version;
  if (typeof witBindgen !== 'string' || !witBindgen) errors.push(`${label}: support matrix is missing the pinned wit-bindgen version`);
  for (const [key, value] of Object.entries(wanted.wit)) {
    if (support.witRevision?.[key] !== value) errors.push(`${label}: support matrix witRevision.${key} must be ${value}`);
  }
  const recipe = support.recipes?.[rust?.recipeId];
  if (!recipe || recipe.language !== 'rust' || recipe.kind !== 'llm-provider' || recipe.world !== wanted.recipeWorld) {
    errors.push(`${label}: support matrix must keep the advertised Rust guest-v3 recipe for ${wanted.recipeWorld}`);
  }
  return typeof witBindgen === 'string' && witBindgen ? { witBindgen } : undefined;
}

function checkSdkDependency(root, errors, label) {
  const manifest = readText(root, `${RUST_SECRET_HTTP_V3.sdkPath}/Cargo.toml`, errors, `${label} SDK dependency`);
  if (manifest !== undefined && stringValue(readCargoTables(manifest).get('package'), 'name') !== 'glixo-extension-sdk') {
    errors.push(`${label} SDK dependency: ${RUST_SECRET_HTTP_V3.sdkPath}/Cargo.toml must be the glixo-extension-sdk package`);
  }
  readText(root, `${RUST_SECRET_HTTP_V3.sdkPath}/src/lib.rs`, errors, `${label} SDK dependency`);
}

function checkWitDependency(root, referenceId, errors, label) {
  const base = `references/${referenceId}/rust/wit`;
  const wanted = RUST_SECRET_HTTP_V3.wit;
  const files = [
    [`${base}/provider-compat.wit`, wanted.providerWorld],
    [`${base}/deps/http/broker.wit`, wanted.http],
    [`${base}/deps/http/types.wit`, wanted.http],
    [`${base}/deps/llm-types/types.wit`, wanted.llmTypes],
  ];
  for (const [path, packageName] of files) {
    const text = readText(root, path, errors, `${label} WIT dependency`);
    if (text === undefined) continue;
    // Comments are blanked first so a declaration that only exists inside a
    // `//`, `///` or (nested) block comment does not count.
    const lexed = maskNonCode(text, { literals: false });
    if (lexed.problem) { errors.push(`${label} WIT dependency: ${path} ${lexed.problem}`); continue; }
    const declared = /^package\s+([^\s;]+)\s*;/m.exec(lexed.masked);
    if (declared?.[1] !== packageName) errors.push(`${label} WIT dependency: ${path} must declare package ${packageName}`);
    if (path.endsWith('provider-compat.wit') && !new RegExp(`^world\\s+${RUST_SECRET_HTTP_V3.world}\\s*\\{`, 'm').test(lexed.masked)) {
      errors.push(`${label} WIT dependency: ${path} must define world ${RUST_SECRET_HTTP_V3.world}`);
    }
  }
}

function checkTree(root, relDir, errors, label, state = { entries: 0 }, depth = 0) {
  if (depth > maxTreeDepth) { errors.push(`${label}: source tree is nested deeper than ${maxTreeDepth} levels`); return; }
  for (const name of readdirSync(join(root, ...relDir.split('/')))) {
    state.entries += 1;
    if (state.entries > maxTreeEntries) { errors.push(`${label}: source tree has more than ${maxTreeEntries} entries`); return; }
    const relPath = `${relDir}/${name}`;
    const info = lstatSync(join(root, ...relPath.split('/')));
    if (info.isSymbolicLink()) { errors.push(`${label}: ${relPath} is a symbolic link or junction`); continue; }
    if (info.isDirectory()) {
      // Untracked cargo output; the same directory the legacy tree walk skips.
      if (name !== 'target') checkTree(root, relPath, errors, label, state, depth + 1);
    } else if (!info.isFile()) {
      errors.push(`${label}: ${relPath} is not a regular file or directory`);
    } else if (scaffoldMarkers.has(name.toLowerCase())) {
      errors.push(`${label}: ${relPath} marks this source tree as normal scaffold content; qualification source must not carry ${[...scaffoldMarkers].join(', ')}`);
    }
  }
}

function checkCrate(root, referenceId, facts, errors, label) {
  const crate = expectedSourcePath(referenceId);
  const crateDir = inspect(root, crate, 'directory');
  if (crateDir.problem) { errors.push(`${label}: ${crateDir.problem}`); return; }
  const srcDir = inspect(root, `${crate}/src`, 'directory');
  if (srcDir.problem) errors.push(`${label}: ${srcDir.problem}`);
  checkTree(root, crate, errors, label);

  const manifestText = readText(root, `${crate}/Cargo.toml`, errors, label);
  const lockText = readText(root, `${crate}/Cargo.lock`, errors, label);
  const librarySource = readText(root, `${crate}/src/lib.rs`, errors, label);
  readText(root, `${crate}/README.md`, errors, label);

  let packageName;
  if (manifestText !== undefined) {
    const tables = readCargoTables(manifestText);
    for (const name of ['package', 'lib', 'dependencies']) {
      const table = tables.get(name);
      if (!table) errors.push(`${label}: Cargo.toml must have a [${name}] table`);
      else if (table.count > 1 || table.duplicates.size) errors.push(`${label}: Cargo.toml [${name}] must appear once without repeated keys`);
    }
    packageName = stringValue(tables.get('package'), 'name');
    if (!packageName) errors.push(`${label}: Cargo.toml [package] name must be a plain string`);
    const lib = tables.get('lib');
    if (lib) {
      if (stringValue(lib, 'name') !== RUST_SECRET_HTTP_V3.library) errors.push(`${label}: Cargo.toml [lib] name must be ${RUST_SECRET_HTTP_V3.library}`);
      if (lib.values.get('crate-type')?.list?.join(',') !== 'cdylib') errors.push(`${label}: Cargo.toml [lib] crate-type must be exactly ["cdylib"]`);
      const libPath = lib.values.get('path');
      if (libPath !== undefined && libPath.string !== 'src/lib.rs') errors.push(`${label}: Cargo.toml [lib] path must be src/lib.rs`);
    }
    const dependencies = tables.get('dependencies');
    if (dependencies) {
      const witBindgen = stringValue(dependencies, 'wit-bindgen');
      if (facts && witBindgen !== `=${facts.witBindgen}`) errors.push(`${label}: Cargo.toml wit-bindgen must be pinned to =${facts.witBindgen} from the support matrix`);
      const sdk = dependencies.values.get('glixo-extension-sdk')?.path;
      if (sdk === undefined || posix.normalize(posix.join(crate, sdk)) !== RUST_SECRET_HTTP_V3.sdkPath) {
        errors.push(`${label}: Cargo.toml glixo-extension-sdk must be a path dependency resolving to ${RUST_SECRET_HTTP_V3.sdkPath}`);
      }
    }
  }

  if (lockText !== undefined) {
    if (!/^# This file is automatically @generated by Cargo\./.test(lockText)) errors.push(`${label}: Cargo.lock must be the Cargo-generated lockfile`);
    const locked = new Map();
    for (const block of lockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
      const name = /^name = "([^"]+)"$/m.exec(block)?.[1];
      const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
      if (name) locked.set(name, version);
    }
    if (packageName && !locked.has(packageName)) errors.push(`${label}: Cargo.lock does not lock the ${packageName} package`);
    if (facts && locked.get('wit-bindgen') !== facts.witBindgen) errors.push(`${label}: Cargo.lock must lock wit-bindgen ${facts.witBindgen}`);
    if (!locked.has('glixo-extension-sdk')) errors.push(`${label}: Cargo.lock does not lock glixo-extension-sdk`);
  }

  if (librarySource !== undefined) {
    // Matched against the comment- and literal-blanked text, anchored to the line
    // start, so neither a comment nor a macro-looking line inside a (raw or
    // multi-line) string can satisfy it. This only ties the crate to the Rust
    // example's WIT; it is not a compile check and does not prove an export exists.
    const lexed = maskNonCode(librarySource, { literals: true });
    if (lexed.problem) errors.push(`${label}: src/lib.rs ${lexed.problem}`);
    else {
      const generated = [...lexed.masked.matchAll(/^[ \t]*wit_bindgen::generate!\(\{([^{}]*)\}\)\s*;/gmd)];
      if (generated.length !== 1) errors.push(`${label}: src/lib.rs must contain exactly one top-level wit_bindgen::generate! invocation`);
      else {
        // The argument keys are found in the blanked text; their string values are
        // read back from the original source at the same offsets.
        const [bodyStart, bodyEnd] = generated[0].indices[1];
        const body = lexed.masked.slice(bodyStart, bodyEnd);
        const argument = (key) => {
          const found = new RegExp(`\\b${key}:\\s*"([^"]*)"`, 'd').exec(body);
          return found ? librarySource.slice(bodyStart + found.indices[1][0], bodyStart + found.indices[1][1]) : undefined;
        };
        const witPath = argument('path');
        const world = argument('world');
        const expectedWit = `references/${referenceId}/rust/wit`;
        if (witPath === undefined || posix.normalize(posix.join(crate, witPath)) !== expectedWit) errors.push(`${label}: src/lib.rs must generate bindings from ${expectedWit}`);
        if (world !== RUST_SECRET_HTTP_V3.world) errors.push(`${label}: src/lib.rs must generate the ${RUST_SECRET_HTTP_V3.world} world`);
      }
    }
  }
}

// The advertised C#/Go/Rust/TypeScript projects must stay free of any
// reference to the qualification crate.
function checkAuthorProjects(root, referenceId, errors, label) {
  const markers = [/qualification[\\/]/i, new RegExp(RUST_SECRET_HTTP_V3.directory, 'i'), new RegExp(RUST_SECRET_HTTP_V3.library, 'i')];
  for (const language of authorLanguages) {
    const directory = `references/${referenceId}/${language}`;
    const listing = inspect(root, directory, 'directory');
    if (listing.problem) continue; // missing or redirected projects are reported by the caller
    const names = new Set(authorBuildFiles);
    for (const name of readdirSync(listing.path)) if (name.toLowerCase().endsWith('.csproj')) names.add(name);
    for (const name of names) {
      const found = inspect(root, `${directory}/${name}`, 'file');
      if (found.problem || found.info.size > maxTextBytes) continue;
      const text = readFileSync(found.path, 'utf8');
      if (markers.some((marker) => marker.test(text))) errors.push(`${label}: ${directory}/${name} must not reference the qualification source`);
    }
  }
}

/**
 * @param {{ root: string, item: object, support?: object }} options
 * @returns {string[]} error messages; empty when the item declares no
 *   qualification or the declared source is structurally valid.
 */
export function verifyRustProviderQualification({ root, item, support }) {
  if (!isPlainObject(item) || item.qualification === undefined) return [];
  const referenceId = item.id;
  if (typeof referenceId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(referenceId)) return [`qualification: reference id is invalid: ${String(referenceId)}`];
  const label = `${referenceId}: qualification`;
  const qualification = item.qualification;
  if (!isPlainObject(qualification)) return [`${label} must be an object`];

  const errors = [];
  for (const key of Object.keys(qualification)) {
    if (!knownKeys.has(key)) errors.push(`${label}.${key} is not a recognized qualification declaration`);
  }
  if (item.kind !== 'executable' || item.status === 'planned') errors.push(`${label} requires a published executable reference, not ${item.kind}/${item.status}`);
  if (qualification.purpose !== undefined && (typeof qualification.purpose !== 'string' || !qualification.purpose.trim())) errors.push(`${label}.purpose must be a non-empty string`);
  for (const key of declarationKeys) {
    if (!Object.hasOwn(qualification, key)) errors.push(`${label}.${key} is required`);
  }
  if (qualification.rustSecretHttpV3Library !== undefined && qualification.rustSecretHttpV3Library !== RUST_SECRET_HTTP_V3.library) {
    errors.push(`${label}.rustSecretHttpV3Library must be the supported identifier ${RUST_SECRET_HTTP_V3.library}`);
  }
  if (qualification.rustSecretHttpV3Target !== undefined && qualification.rustSecretHttpV3Target !== RUST_SECRET_HTTP_V3.target) {
    errors.push(`${label}.rustSecretHttpV3Target must be ${RUST_SECRET_HTTP_V3.target}`);
  }
  if (Object.hasOwn(qualification, 'rustSecretHttpV3SourcePath')) {
    const problem = sourcePathProblem(qualification.rustSecretHttpV3SourcePath, referenceId);
    if (problem) errors.push(`${label}.rustSecretHttpV3SourcePath ${problem}`);
    else {
      const facts = checkSupport(support, errors, label);
      checkSdkDependency(root, errors, label);
      checkWitDependency(root, referenceId, errors, label);
      checkCrate(root, referenceId, facts, errors, label);
      checkAuthorProjects(root, referenceId, errors, label);
    }
  }
  return errors;
}
