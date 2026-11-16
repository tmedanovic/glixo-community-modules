import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg || process.argv.length !== 4) throw new Error('expected source and destination paths');
const source = resolve(sourceArg);
const destination = resolve(destinationArg);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
