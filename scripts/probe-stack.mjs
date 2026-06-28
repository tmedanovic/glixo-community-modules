import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveAppCreatorE2eConfig } from '../../glixo-code/scripts/e2e/appCreatorE2eConfig.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../../glixo-code/standalone/package.json'));
const sodium = require('libsodium-wrappers');
const config = resolveAppCreatorE2eConfig();

await sodium.ready;
const seed = fs.readFileSync(path.join(config.devHome, 'local-account.seed'));
const kp = sodium.crypto_sign_seed_keypair(seed);
const ts = Date.now();
const msg = Buffer.from(`glixo-code\n${ts}\n${Buffer.from(kp.publicKey).toString('base64')}`);
const sig = sodium.crypto_sign_detached(msg, kp.privateKey);
const res = await fetch(`${config.serverUrl}/v1/auth/device/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    publicKey: Buffer.from(kp.publicKey).toString('base64'),
    timestampMs: ts,
    signature: Buffer.from(sig).toString('base64'),
    product: 'glixo-code',
    label: 'probe',
  }),
});
const text = await res.text();
console.log('session status', res.status, text.slice(0, 300));
if (!res.ok) process.exit(1);
const tok = JSON.parse(text);
const machines = await fetch(`${config.serverUrl}/v1/machines`, {
  headers: { Authorization: `Bearer ${tok.accessToken}` },
}).then((r) => r.json());
console.log(JSON.stringify(machines, null, 2));
