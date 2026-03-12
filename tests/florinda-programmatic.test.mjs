import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { implementTest } from "../electron/services/claudeService.mjs";
import { DEFAULT_MODELS } from "../electron/services/modelPreferences.mjs";
import { renderVariant } from "../electron/services/playwrightService.mjs";

const PROJECT_ROOT =
  process.env.MUTATR_LIVE_PROJECT_ROOT || "/Users/ahmedashraf/Documents/untitled folder/Florinda/Landing";
const API_KEY = process.env.E2E_CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const ROUTE = "/";
const PAGE_FILE = "app/page.tsx";
const CANONICAL_TESTS = [
  {
    title: "Strengthen hero CTA copy",
    implementationPrompt:
      "Update the primary CTA copy on this page to be more explicit about value and urgency. Keep style consistent.",
  },
  {
    title: "Surface social proof earlier",
    implementationPrompt:
      "Add lightweight social proof (customer logos or testimonial snippet) above the fold without breaking layout.",
  },
];
const COPY_EXCLUDE = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", ".turbo"]);

test(
  "Florinda homepage canonical treatments implement and render programmatically",
  { timeout: 20 * 60_000 },
  async (t) => {
    if (!API_KEY) {
      t.skip("Set E2E_CLAUDE_API_KEY or ANTHROPIC_API_KEY to run the live Florinda integration test.");
      return;
    }

    for (const suggestedTest of CANONICAL_TESTS) {
      const tempRoot = path.join(os.tmpdir(), `mutatr-florinda-${crypto.randomUUID().slice(0, 8)}`);
      const imageDir = path.join(os.tmpdir(), `mutatr-florinda-img-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await copyProjectLight(PROJECT_ROOT, tempRoot);
        await fs.mkdir(imageDir, { recursive: true });

        const impl = await implementTest({
          projectRoot: tempRoot,
          page: { route: ROUTE, filePath: PAGE_FILE },
          test: suggestedTest,
          apiKey: API_KEY,
          model: DEFAULT_MODELS.implementationModel,
        });

        const detectedProjectChanges = await detectProjectFileChanges(PROJECT_ROOT, tempRoot);
        const changedFiles = uniquePaths([
          ...detectedProjectChanges.changedFiles,
          ...detectedProjectChanges.deletedFiles,
        ]);

        assert.equal(changedFiles.length > 0, true, `No project edits detected for ${suggestedTest.title}`);
        assert.equal(
          Array.isArray(impl.changedFiles) && impl.changedFiles.length > 0,
          true,
          `Model returned no changed files for ${suggestedTest.title}`
        );

        const render = await renderVariant({
          projectRoot: tempRoot,
          route: ROUTE,
          imageDir,
          label: `${ROUTE} - ${suggestedTest.title}`,
        });

        assert.ok(render.screenshotPath, `Render produced no screenshot path for ${suggestedTest.title}`);
        assert.equal(
          (render.attentionAnchors ?? []).length >= 4,
          true,
          `Render looks like fallback output for ${suggestedTest.title}`
        );
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
        await fs.rm(imageDir, { recursive: true, force: true });
      }
    }
  }
);

async function copyProjectLight(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(path.basename(source)),
  });
  await linkSharedDirectory(src, dest, "node_modules");
}

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

async function detectProjectFileChanges(sourceRoot, editedRoot) {
  const [sourceFiles, editedFiles] = await Promise.all([
    buildProjectFileHashMap(sourceRoot),
    buildProjectFileHashMap(editedRoot),
  ]);

  const changedFiles = [];
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

async function buildProjectFileHashMap(root) {
  const files = new Map();
  await walkProjectFiles(root, "", files);
  return files;
}

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

function uniquePaths(paths) {
  return [...new Set(paths.filter((value) => typeof value === "string" && value.trim()))];
}
