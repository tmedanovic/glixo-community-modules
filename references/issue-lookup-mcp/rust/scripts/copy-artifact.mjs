import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("usage: node scripts/copy-artifact.mjs <source> <destination>");
const resolvedSource = resolve(source);
const resolvedDestination = resolve(destination);
mkdirSync(dirname(resolvedDestination), { recursive: true });
copyFileSync(resolvedSource, resolvedDestination);
