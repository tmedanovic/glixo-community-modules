import { readFileSync } from 'node:fs';

const matrix = JSON.parse(readFileSync(new URL('../packages/extension-sdk/support-matrix.json', import.meta.url)));
const compilerKeys = {
  csharp: 'dotnetSdk',
  go: 'go',
  rust: 'rustc',
  typescript: 'node',
};

function compilerVersion(language) {
  const key = compilerKeys[language];
  if (!key || !matrix.languages?.[language]) {
    throw new Error(`Unknown extension language: ${language}`);
  }
  const version = matrix.toolchains?.[language]?.[key]?.version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error(`Missing ${language} compiler pin at toolchains.${language}.${key}.version`);
  }
  return version;
}

const requested = process.argv[2];
if (requested === '--all') {
  for (const language of Object.keys(compilerKeys)) {
    console.log(`${language}: ${compilerVersion(language)}`);
  }
} else {
  console.log(`compiler=${compilerVersion(requested)}`);
}
