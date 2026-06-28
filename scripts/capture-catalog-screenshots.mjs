#!/usr/bin/env node
/**
 * Install catalog extensions against a running moron-cursor stack and capture PNG screenshots.
 *
 * Requires: dev.cmd (8103 / 33103 / 5180), Playwright in glixo-code/standalone.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const communityRoot = path.resolve(__dirname, '..');
const codeRoot = path.resolve(communityRoot, '../glixo-code');
const platformRoot = path.resolve(communityRoot, '../glixo-platform');
const require = createRequire(path.join(codeRoot, 'standalone/package.json'));
const { chromium } = require('playwright');
const sodium = require(path.join(codeRoot, 'standalone/node_modules/libsodium-wrappers'));

const { resolveAppCreatorE2eConfig } = await import(
  new URL('../../glixo-code/scripts/e2e/appCreatorE2eConfig.mjs', import.meta.url).href
);
const { findCatalogManifests } = await import(
  new URL('../../glixo-dev-portal/scripts/catalog-manifest-paths.mjs', import.meta.url).href
);

const config = resolveAppCreatorE2eConfig();
const API = (config.serverUrl ?? 'http://127.0.0.1:33103').replace(/\/+$/, '');
const UI = (config.baseUrl ?? 'http://127.0.0.1:8103').replace(/\/+$/, '');
const headless = process.env.E2E_HEADED !== '1' && process.env.HEADED !== '1';
const onlyId = optionValue('--only');

async function main() {
  await assertStack();
  await ensureCommunityCatalogSource();
  const manifests = findCatalogManifests(communityRoot).filter((manifestPath) => {
    const manifest = readJson(manifestPath);
    if (manifest?.catalog?.listed === false) return false;
    if (onlyId && manifest.id !== onlyId) return false;
    return true;
  });
  if (manifests.length === 0) {
    console.error('No catalog manifests to capture.');
    process.exit(1);
  }

  console.log('Installing extensions…');
  for (const manifestPath of manifests) {
    await installExtension(readJson(manifestPath).id);
  }

  const sessionUrl = await resolveCodeSessionUrl();
  console.log(`Code session: ${sessionUrl}`);

  const browser = await chromium.launch({
    headless,
    args: headless ? [] : ['--start-maximized'],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await installWebPolyfills(context);
    const page = await context.newPage();
    await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await page.getByPlaceholder(/Talk to glixo-code/i).waitFor({ state: 'visible', timeout: 180_000 });

    for (const manifestPath of manifests) {
      const manifest = readJson(manifestPath);
      const moduleRoot = path.dirname(manifestPath);
      const outPath = path.join(moduleRoot, 'assets', 'screenshot.png');
      mkdirSync(path.dirname(outPath), { recursive: true });

      console.log(`\n→ ${manifest.id}`);
      try {
        const toolbarAction = (manifest.contributes?.actions ?? []).find((a) => a.slot === 'agxos.toolbar');
        if (toolbarAction?.title) {
          await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
          await page.getByPlaceholder(/Talk to glixo-code/i).waitFor({ state: 'visible', timeout: 180_000 });
          await captureAgxosToolbarApp(page, toolbarAction.title, outPath);
        } else {
          await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
          await page.getByPlaceholder(/Talk to glixo-code/i).waitFor({ state: 'visible', timeout: 180_000 });
          await captureCodeSession(page, manifest, outPath);
        }

        updateManifestScreenshot(manifestPath, manifest);
        const themeRef = path.join(communityRoot, 'design/theme-references', `${manifest.id}.png`);
        writeFileSync(themeRef, readFileSync(outPath));
        console.log(`  wrote ${path.relative(communityRoot, outPath)}`);
        console.log(`  theme-ref ${path.relative(communityRoot, themeRef)}`);
      } catch (err) {
        console.error(`  FAILED ${manifest.id}: ${err.message ?? err}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\nDone. Run: node scripts/pack-catalog-artifacts.mjs && cd ../glixo-dev-portal && npm run catalog:sync');
}

async function resolveCodeSessionUrl() {
  await sodium.ready;
  const seedPath = path.join(config.devHome, 'local-account.seed');
  if (!existsSync(seedPath)) {
    throw new Error(`Missing ${seedPath} — run dev.cmd first.`);
  }
  const seed = readFileSync(seedPath);
  const keypair = sodium.crypto_sign_seed_keypair(seed);
  const timestampMs = Date.now();
  const message = Buffer.from(
    `glixo-code\n${timestampMs}\n${Buffer.from(keypair.publicKey).toString('base64')}`,
    'utf8',
  );
  const signature = sodium.crypto_sign_detached(message, keypair.privateKey);
  const sessionRes = await fetch(`${API}/v1/auth/device/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      publicKey: Buffer.from(keypair.publicKey).toString('base64'),
      timestampMs,
      signature: Buffer.from(signature).toString('base64'),
      product: 'glixo-code',
      label: 'catalog-screenshot-capture',
    }),
  });
  const sessionJson = await sessionRes.json();
  if (!sessionRes.ok || !sessionJson.accessToken) {
    throw new Error(`device session failed: ${JSON.stringify(sessionJson).slice(0, 200)}`);
  }
  const token = sessionJson.accessToken;
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  if (!config.apiKey) {
    throw new Error('Set E2E_OPENAI_API_KEY or E2E_ANTHROPIC_API_KEY for code session bootstrap.');
  }
  await ensureLlmProviderInstalled(config.provider);
  const integrationId = await ensureIntegration(headers, config.provider, config.apiKey);
  await fetch(`${API}/v1/code/account/defaults`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: config.model, integration_account_id: integrationId }),
  }).catch(() => {});

  const machines = await fetch(`${API}/v1/machines`, { headers }).then((r) => r.json());
  const machine = (Array.isArray(machines) ? machines : machines?.machines ?? []).find((m) => m.active);
  if (!machine) throw new Error('No active daemon — restart dev.cmd.');

  const boot = await fetch(`${API}/v1/projects/bootstrap`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ machine_id: machine.id, cwd: config.workspaceCwd, model: config.model }),
  }).then((r) => r.json());

  const body = {
    machine_id: machine.id,
    cwd: config.workspaceCwd,
    workspace_id: boot.workspaceId,
    model: config.model,
    integration_account_id: integrationId,
  };

  const codeSession = await fetch(`${API}/v1/code/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const sessionId = codeSession.sessionId ?? codeSession.session_id ?? codeSession.id;
  if (!sessionId) throw new Error(`code session failed: ${JSON.stringify(codeSession).slice(0, 400)}`);
  return `${UI}/code/${encodeURIComponent(sessionId)}`;
}

async function ensureLlmProviderInstalled(provider) {
  const extensionId = provider === 'anthropic'
    ? 'glixo.providers.anthropic'
    : provider === 'openai'
      ? 'glixo.providers.openai'
      : null;
  if (!extensionId) return;

  const moduleRoot = path.join(config.devHome, 'modules', extensionId);
  if (existsSync(moduleRoot)) {
    const hasState = existsSync(path.join(moduleRoot, 'module-install-state.json'))
      || readdirSync(moduleRoot).some((v) =>
        existsSync(path.join(moduleRoot, v, 'module-install-state.json')));
    if (hasState) return;
  }

  const src = path.join(communityRoot, 'bundled', provider);
  const manifestPath = path.join(src, 'glixo.module.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`LLM provider source missing: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const version = manifest.version ?? '0.1.0-alpha';
  const installDir = path.join(moduleRoot, version);
  mkdirSync(installDir, { recursive: true });
  writeFileSync(path.join(installDir, 'glixo.module.json'), readFileSync(manifestPath));
  writeFileSync(path.join(installDir, 'module-install-state.json'), `${JSON.stringify({
    moduleId: extensionId,
    name: manifest.name ?? extensionId,
    version,
    status: 'installed',
    manifestPath: path.join(installDir, 'glixo.module.json'),
  }, null, 2)}\n`);
}

async function ensureIntegration(headers, provider, apiKey) {
  const integrations = await fetch(`${API}/v1/integrations`, { headers }).then((r) => r.json()).catch(() => []);
  const list = Array.isArray(integrations) ? integrations : integrations?.items ?? [];
  const existing = list.find((x) => x.provider === provider);
  if (existing?.id) {
    await fetch(`${API}/v1/integrations/${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        label: `catalog-capture-${provider}`,
        tokenPayload: JSON.stringify({ apiKey }),
      }),
    }).catch(() => {});
    return existing.id;
  }
  const created = await fetch(`${API}/v1/integrations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider,
      label: `catalog-capture-${provider}`,
      tokenPayload: JSON.stringify({ apiKey }),
      transport: 'direct',
    }),
  });
  if (!created.ok) {
    throw new Error(`${provider} integration failed HTTP ${created.status}: ${(await created.text()).slice(0, 200)}`);
  }
  const json = await created.json();
  return json.id;
}

async function assertStack() {
  for (const url of [`${UI}/code`, `${API}/v1/extensions/catalog`]) {
    const res = await fetch(url, { redirect: 'manual' });
    if (!res.ok && res.status !== 304) {
      throw new Error(`Stack not reachable: ${url} (${res.status}). Run dev.cmd first.`);
    }
  }
}

async function ensureCommunityCatalogSource() {
  const catalogRoot = path.join(communityRoot, 'catalog');
  const sources = await fetch(`${API}/v1/extensions/sources`).then((r) => r.json()).catch(() => ({ sources: [] }));
  const list = Array.isArray(sources) ? sources : sources?.sources ?? [];
  const normalized = catalogRoot.replace(/\\/g, '/').toLowerCase();
  const exists = list.some((s) => String(s.url ?? '').replace(/\\/g, '/').toLowerCase().includes(normalized));
  if (exists) return;
  await fetch(`${API}/v1/extensions/sources`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Community modules catalog',
      url: catalogRoot,
      kind: 'localFolder',
      enabled: true,
    }),
  });
  await fetch(`${API}/v1/extensions/sources/refresh`, { method: 'POST' });
}

async function installExtension(extensionId) {
  const id = encodeURIComponent(extensionId);
  const details = await fetch(`${API}/v1/extensions/${id}`).then((r) => r.ok ? r.json() : null).catch(() => null);
  const state = details?.extension?.state ?? details?.state ?? '';
  if (['configured', 'running', 'started', 'installed'].some((s) => String(state).toLowerCase().includes(s))) {
    return;
  }

  for (const step of ['preview-install', 'install', 'accept-policy']) {
    const res = await fetch(`${API}/v1/extensions/${id}/${step}`, { method: 'POST' });
    if (res.ok) continue;
    const body = await res.text();
    if (step === 'install' && res.status === 409) {
      console.warn(`  install ${extensionId}: ${body.slice(0, 80)}`);
      continue;
    }
    if (step === 'accept-policy' && res.status === 409) {
      console.warn(`  accept-policy ${extensionId}: skipped (${body.slice(0, 80)})`);
      continue;
    }
    throw new Error(`${step} ${extensionId} failed HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  await fetch(`${API}/v1/extensions/${id}/start`, { method: 'POST' }).catch(() => {});
}

async function captureAgxosToolbarApp(page, toolbarTitle, outPath) {
  const enterAgxos = page.locator('[title="Enter Agxos"], [aria-label="Enter Agxos"]').first();
  await enterAgxos.waitFor({ state: 'visible', timeout: 60_000 });
  await enterAgxos.click({ force: true });

  const iframeSel = 'iframe[title="Agxos replay"], iframe[src*="5180"], iframe[src*="127.0.0.1"]';
  const frameLocator = page.frameLocator(iframeSel).first();
  await page.locator(iframeSel).first().waitFor({ state: 'visible', timeout: 60_000 });

  const toolbarBtn = frameLocator.getByRole('button', { name: new RegExp(toolbarTitle, 'i') })
    .or(frameLocator.getByText(toolbarTitle, { exact: false }));
  try {
    await toolbarBtn.first().waitFor({ state: 'visible', timeout: 90_000 });
    await toolbarBtn.first().click({ force: true });
    await page.waitForTimeout(2000);
  } catch {
    console.warn(`  toolbar "${toolbarTitle}" not found — capturing Agxos shell`);
  }

  const appFrame = frameLocator.frameLocator('iframe').first();
  try {
    await appFrame.locator('body').waitFor({ state: 'visible', timeout: 15_000 });
    await appFrame.locator('body').screenshot({ path: outPath });
  } catch {
    await frameLocator.locator('body').screenshot({ path: outPath });
  }
}

async function captureCodeSession(page, manifest, outPath) {
  await page.screenshot({ path: outPath, fullPage: false });
}

async function installWebPolyfills(context) {
  await context.addInitScript(() => {
    if (typeof globalThis.Buffer !== 'undefined') return;
    class BufferShim extends Uint8Array {
      static from(value, encoding) {
        if (encoding === 'base64') {
          const s = atob(String(value));
          const out = new BufferShim(s.length);
          for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
          return out;
        }
        if (typeof value === 'string') return new TextEncoder().encode(value);
        return new Uint8Array(value);
      }
    }
    globalThis.Buffer = BufferShim;
  });
}

function updateManifestScreenshot(manifestPath, manifest) {
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const shot = images.find((i) => i.type === 'screenshot') ?? images[0];
  if (shot) {
    shot.url = 'assets/screenshot.png';
    shot.alt = shot.alt ?? `${manifest.name} screenshot`;
  } else {
    manifest.images = [{ url: 'assets/screenshot.png', alt: `${manifest.name} screenshot`, type: 'screenshot' }];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
