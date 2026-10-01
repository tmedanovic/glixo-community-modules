import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg || process.argv.length !== 4) throw new Error("usage: node scripts/copy-artifact.mjs <source> <target>");
const inside = (path) => path === root || path.startsWith(root + sep);
const source = resolve(root, sourceArg);
const target = resolve(root, targetArg);
if (!inside(source) || !inside(target)) throw new Error("artifact path escapes project");
if (!statSync(source).isFile()) throw new Error("artifact source is not a file");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
