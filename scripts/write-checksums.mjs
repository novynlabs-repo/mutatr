import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const releaseDir = path.resolve("release");
const checksumFile = path.join(releaseDir, "SHA256SUMS.txt");

const artifactExtensions = new Set([
  ".dmg",
  ".zip",
  ".pkg",
  ".blockmap",
  ".yml",
  ".yaml",
]);

const artifactPaths = await collectArtifacts(releaseDir);

if (!artifactPaths.length) {
  console.warn("[mutatr] No release artifacts found under release/; skipping checksum generation.");
  process.exit(0);
}

const lines = [];
for (const artifactPath of artifactPaths) {
  const relativePath = path.relative(releaseDir, artifactPath).split(path.sep).join("/");
  const digest = await sha256File(artifactPath);
  lines.push(`${digest}  ${relativePath}`);
}

await fs.writeFile(checksumFile, `${lines.join("\n")}\n`, "utf8");
console.log(`[mutatr] Wrote ${artifactPaths.length} checksums to ${path.relative(process.cwd(), checksumFile)}.`);

async function collectArtifacts(rootDir) {
  /** @type {string[]} */
  const found = [];
  try {
    await walk(rootDir, found);
  } catch {
    return [];
  }
  return found.sort();
}

async function walk(currentDir, found) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, found);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === "SHA256SUMS.txt") continue;
    if (!artifactExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    found.push(fullPath);
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}
