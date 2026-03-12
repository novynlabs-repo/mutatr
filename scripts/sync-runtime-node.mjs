import fs from "node:fs/promises";
import path from "node:path";

const sourceNodePath = process.env.MUTATR_RUNTIME_NODE_SOURCE || process.execPath;
const runtimeDir = path.resolve("build/runtime/bin");
const bundledNodePath = path.join(runtimeDir, "node");

await fs.mkdir(runtimeDir, { recursive: true });
await fs.copyFile(sourceNodePath, bundledNodePath);
await fs.chmod(bundledNodePath, 0o755);

console.log(
  `[mutatr] Bundled Node runtime from ${sourceNodePath} to ${path.relative(process.cwd(), bundledNodePath)}.`
);
