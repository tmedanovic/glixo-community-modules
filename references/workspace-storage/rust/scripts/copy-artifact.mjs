import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('usage: node scripts/copy-artifact.mjs <source> <destination>');
const from = resolve(source);
const to = resolve(destination);
await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
