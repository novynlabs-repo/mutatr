import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const JS_FILE_RE = /\.(tsx|ts|jsx|js|mdx)$/i;
const APP_DIR_RE = /^(?:src\/)?app\//i;
const PAGES_DIR_RE = /^(?:src\/)?pages\//i;
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".vscode",
]);

/**
 * @param {string} selectedPath
 */
export async function normalizeProjectRoot(selectedPath) {
  const stat = await fs.stat(selectedPath);
  return stat.isDirectory() ? selectedPath : path.dirname(selectedPath);
}

/**
 * @param {string} rootPath
 */
export async function inferProjectName(rootPath) {
  const packageJsonPath = path.join(rootPath, "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // fallback below
  }
  return path.basename(rootPath);
}

/**
 * @param {string} rootPath
 * @returns {Promise<import('./types.mjs').PageRecord[]>}
 */
export async function discoverPages(rootPath) {
  /** @type {string[]} */
  const files = [];
  await walk(rootPath, files);

  const pageFiles = files.filter((filePath) => {
    const rel = path.relative(rootPath, filePath).replace(/\\/g, "/");
    if (!JS_FILE_RE.test(rel)) return false;
    return APP_DIR_RE.test(rel) || PAGES_DIR_RE.test(rel);
  });

  const rankedCandidates = pageFiles
    .map((filePath) => {
      const route = filePathToRoute(rootPath, filePath);
      if (!route) return null;
      return {
        route,
        filePath,
        priority: routePriority(rootPath, filePath),
      };
    })
    .filter((candidate) => candidate !== null)
    .sort((a, b) => {
      const routeCmp = a.route.localeCompare(b.route);
      if (routeCmp !== 0) return routeCmp;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.filePath.localeCompare(b.filePath);
    });

  /** @type {Map<string, import('./types.mjs').PageRecord>} */
  const byRoute = new Map();

  for (const candidate of rankedCandidates) {
    if (byRoute.has(candidate.route)) continue;

    const { route, filePath } = candidate;
    byRoute.set(route, {
      id: hash(`${filePath}:${route}`),
      route,
      filePath,
    });
  }

  return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * @param {string} rootPath
 * @param {string[]} out
 */
async function walk(rootPath, out) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, out);
      continue;
    }
    if (entry.isFile()) {
      out.push(fullPath);
    }
  }
}

/**
 * @param {string} rootPath
 * @param {string} filePath
 */
function filePathToRoute(rootPath, filePath) {
  const rel = path.relative(rootPath, filePath).replace(/\\/g, "/");

  let routeCore = "";

  if (APP_DIR_RE.test(rel)) {
    const appRel = rel.replace(APP_DIR_RE, "");

    if (!/(^|\/)page\.[tj]sx?$|(^|\/)page\.mdx$/i.test(appRel)) {
      return null;
    }

    routeCore = appRel
      .replace(/(^|\/)page\.[^.]+$/i, "")
      .replace(/\(.*?\)\//g, "")
      .replace(/\(.*?\)/g, "")
      .replace(/\[\.\.\..*?\]/g, "*")
      .replace(/\[.*?\]/g, ":param");
  } else if (PAGES_DIR_RE.test(rel)) {
    const pagesRel = rel.replace(PAGES_DIR_RE, "");
    const pageNoExt = pagesRel.replace(/\.[^.]+$/i, "");

    if (/^api\//i.test(pagesRel)) return null;
    if (/^_app$|^_document$|^_error$/i.test(pageNoExt)) return null;

    routeCore = pageNoExt
      .replace(/\/index$/i, "")
      .replace(/^index$/i, "")
      .replace(/\[\.\.\..*?\]/g, "*")
      .replace(/\[.*?\]/g, ":param");
  } else {
    return null;
  }

  const normalized = `/${routeCore}`
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .trim();

  return normalized === "" ? "/" : normalized;
}

/**
 * @param {string} rootPath
 * @param {string} filePath
 */
function routePriority(rootPath, filePath) {
  const rel = path.relative(rootPath, filePath).replace(/\\/g, "/");
  if (rel.startsWith("app/")) return 0;
  if (rel.startsWith("src/app/")) return 1;
  if (rel.startsWith("pages/")) return 2;
  if (rel.startsWith("src/pages/")) return 3;
  return 10;
}

/**
 * @param {string} input
 */
function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

/**
 * @param {string} projectRoot
 * @returns {Promise<string[]>}
 */
export async function guessDevCommands(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    const scripts = pkg.scripts ?? {};
    /** @type {string[]} */
    const commands = [];

    if (scripts.dev) {
      commands.push(...commandVariants("dev", String(scripts.dev)));
    }

    if (scripts.start) {
      commands.push(...commandVariants("start", String(scripts.start)));
    }

    return [...new Set(commands)];
  } catch {
    return [];
  }
}

/**
 * @param {string} scriptName
 * @param {string} scriptBody
 */
function commandVariants(scriptName, scriptBody) {
  const isNextScript = /\bnext\b/i.test(scriptBody);

  const argVariants = isNextScript
    ? [
        "--webpack --port 4179 --hostname 127.0.0.1",
        "--webpack --port 4179",
        "--webpack -p 4179 --hostname 127.0.0.1",
        "--webpack -p 4179",
        "--port 4179 --hostname 127.0.0.1",
        "--port 4179",
        "-p 4179 --hostname 127.0.0.1",
        "-p 4179",
      ]
    : [
        "--host 127.0.0.1 --port 4179",
        "--port 4179 --host 127.0.0.1",
        "--hostname 127.0.0.1 --port 4179",
        "--port 4179",
      ];

  const npmCommands = argVariants.map((args) => `npm run ${scriptName} -- ${args}`);
  const pnpmCommands = argVariants.map((args) => `pnpm ${scriptName} ${args}`);
  const yarnCommands = argVariants.map((args) => `yarn ${scriptName} ${args}`);

  return [...npmCommands, ...pnpmCommands, ...yarnCommands];
}
