import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const artifact = "dist/glixo-extension.component.wasm";
const digest = "sha256:" + createHash("sha256").update(readFileSync(artifact)).digest("hex");
const manifestPath = "glixo.extension.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const item of manifest.artifacts ?? []) if (item.path === artifact) item.digest = digest;
for (const component of manifest.components ?? []) if (component.artifact === artifact) component.digest = digest;
if (manifest.configurations) {
  const schema = readFileSync("configuration.schema.json");
  const schemaDigest = "sha256:" + createHash("sha256").update(schema).digest("hex");
  for (const item of manifest.configurations) if (item.schema === "configuration.schema.json") item.schemaDigest = schemaDigest;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(digest);
