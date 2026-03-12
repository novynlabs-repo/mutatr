import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { implementTest as defaultImplementTest } from "./claudeService.mjs";

const COPY_EXCLUDE = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", ".turbo"]);

/**
 * Execute a variant implementation in an isolated temp copy. If the agent throws
 * after already applying edits, recover those edits from the temp copy instead
 * of discarding the whole attempt.
 *
 * @param {{
 * projectRoot: string;
 * page: {route:string; filePath:string};
 * test: {title:string; implementationPrompt:string};
 * apiKey?: string;
 * model?: string;
 * onMessage?: (text: string) => void;
 * implementer?: typeof defaultImplementTest;
 * }} input
 */
export async function implementVariantInTempProject(input) {
  const { projectRoot, page, test, apiKey, model, onMessage } = input;
  const implementer = input.implementer || defaultImplementTest;
  const tempRoot = path.join(os.tmpdir(), `mutatr-impl-${crypto.randomUUID().slice(0, 8)}`);

  await copyProjectLight(projectRoot, tempRoot);

  const pageFilePath = normalizeProjectRelativePath(page.filePath, projectRoot);
  if (!pageFilePath) {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Selected page is outside the imported project: ${page.filePath}`);
  }

  /** @type {{summary?: string; changedFiles?: string[]} | null} */
  let impl = null;
  /** @type {Error | null} */
  let implementError = null;

  try {
    impl = await implementer({
      projectRoot: tempRoot,
      page: {
        ...page,
        filePath: pageFilePath,
      },
      test,
      apiKey,
      model,
      onMessage,
    });
  } catch (error) {
    implementError = normalizeError(error);
  }

  const normalizedChangedFiles = normalizeChangedFiles(impl?.changedFiles, tempRoot);
  const detectedProjectChanges = await detectProjectFileChanges(projectRoot, tempRoot);
  const detectedChangedFiles = uniquePaths([
    ...detectedProjectChanges.changedFiles,
    ...detectedProjectChanges.deletedFiles,
  ]);

  if (!detectedChangedFiles.length) {
    if (normalizedChangedFiles.rejected.length > 0) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `Implementation reported unsafe file paths and produced no detectable project edits: ${normalizedChangedFiles.rejected.slice(0, 3).join(", ")}`
      );
    }
    if (normalizedChangedFiles.normalized.length > 0) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `Implementation reported changed files but produced no detectable project edits: ${normalizedChangedFiles.normalized.slice(0, 3).join(", ")}`
      );
    }
    if (implementError) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      throw implementError;
    }
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw new Error("Implementation did not produce any detectable file changes inside the project copy.");
  }

  return {
    test,
    impl: {
      summary: impl?.summary || buildRecoveredSummary(test.title, implementError),
      changedFiles: detectedChangedFiles,
    },
    tempRoot,
    ok: true,
    recoveredFromError: Boolean(implementError),
    errorMessage: implementError?.message || "",
  };
}

/**
 * Lightweight project copy: skips heavy dirs (no node_modules, no .git).
 * Used only for Claude agent edits — no bundler will run here.
 *
 * @param {string} src
 * @param {string} dest
 */
export async function copyProjectLight(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(path.basename(source)),
  });
  await linkSharedDirectory(src, dest, "node_modules");
}

/**
 * @param {string | undefined | null} candidatePath
 * @param {string} allowedRoot
 * @returns {string | null}
 */
export function normalizeProjectRelativePath(candidatePath, allowedRoot) {
  if (typeof candidatePath !== "string") return null;
  const trimmed = candidatePath.trim();
  if (!trimmed || trimmed.includes("\0")) return null;

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(allowedRoot, trimmed.replace(/^[.][/\\]/, ""));
  const rel = path.relative(allowedRoot, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }

  return rel.split(path.sep).join("/");
}

/**
 * @param {string[] | undefined} changedFiles
 * @param {string} allowedRoot
 */
export function normalizeChangedFiles(changedFiles, allowedRoot) {
  /** @type {string[]} */
  const normalized = [];
  /** @type {string[]} */
  const rejected = [];
  const seen = new Set();

  for (const entry of changedFiles ?? []) {
    const rel = normalizeProjectRelativePath(entry, allowedRoot);
    if (!rel) {
      rejected.push(String(entry ?? ""));
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);
    normalized.push(rel);
  }

  return { normalized, rejected };
}

/**
 * Compare the edited temp copy with the imported project so the renderer relies
 * on the file delta that actually happened, not just the model-reported list.
 *
 * @param {string} sourceRoot
 * @param {string} editedRoot
 */
export async function detectProjectFileChanges(sourceRoot, editedRoot) {
  const [sourceFiles, editedFiles] = await Promise.all([
    buildProjectFileHashMap(sourceRoot),
    buildProjectFileHashMap(editedRoot),
  ]);

  /** @type {string[]} */
  const changedFiles = [];
  /** @type {string[]} */
  const deletedFiles = [];
  const allPaths = [...new Set([...sourceFiles.keys(), ...editedFiles.keys()])].sort();

  for (const rel of allPaths) {
    const sourceHash = sourceFiles.get(rel);
    const editedHash = editedFiles.get(rel);
    if (sourceHash === editedHash) continue;
    if (editedHash === undefined) {
      deletedFiles.push(rel);
    } else {
      changedFiles.push(rel);
    }
  }

  return { changedFiles, deletedFiles };
}

/**
 * @param {string} srcRoot
 * @param {string} destRoot
 * @param {string} dirName
 */
async function linkSharedDirectory(srcRoot, destRoot, dirName) {
  const sourceDir = path.join(srcRoot, dirName);
  const destDir = path.join(destRoot, dirName);

  try {
    const stat = await fs.lstat(sourceDir);
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      return;
    }
  } catch {
    return;
  }

  await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
  await fs.symlink(sourceDir, destDir, process.platform === "win32" ? "junction" : "dir");
}

/**
 * @param {string} root
 */
async function buildProjectFileHashMap(root) {
  /** @type {Map<string, string>} */
  const files = new Map();
  await walkProjectFiles(root, "", files);
  return files;
}

/**
 * @param {string} root
 * @param {string} relDir
 * @param {Map<string, string>} files
 */
async function walkProjectFiles(root, relDir, files) {
  const dir = relDir ? path.join(root, relDir) : root;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (COPY_EXCLUDE.has(entry.name)) continue;
    const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkProjectFiles(root, relPath, files);
      continue;
    }
    if (!entry.isFile()) continue;

    const raw = await fs.readFile(fullPath);
    files.set(relPath, crypto.createHash("sha1").update(raw).digest("hex"));
  }
}

/**
 * @param {string} title
 * @param {Error | null} implementError
 */
function buildRecoveredSummary(title, implementError) {
  const suffix = implementError?.message ? ` Agent ended with: ${implementError.message}` : "";
  return `Recovered applied edits for "${title}" from the temp project copy.${suffix}`;
}

/**
 * @param {unknown} error
 */
function normalizeError(error) {
  if (error instanceof Error) return error;
  return new Error(String(error ?? "Implementation failed."));
}

/**
 * @param {string[]} paths
 */
function uniquePaths(paths) {
  return [...new Set(paths.filter((value) => typeof value === "string" && value.trim()))];
}
