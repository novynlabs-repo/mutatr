import fs from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";

/** @typedef {{
 * id: string;
 * name: string;
 * rootPath: string;
 * createdAt: string;
 * pages: import('./types.mjs').PageRecord[];
 * personas: import('./types.mjs').PersonaRecord[];
 * experiments: import('./types.mjs').ExperimentRecord[];
 * lastUpdatedAt: string;
 * status?: string;
 * }} ProjectRecord
 */

/** @typedef {{
 * claudeApiKey?: string;
 * suggestionModel?: string;
 * implementationModel?: string;
 * personasModel?: string;
 * attentionModel?: string;
 * apiKeyStorage?: 'none' | 'env' | 'plaintext';
 * }} AppSettings
 */

/** @typedef {{ projects: ProjectRecord[]; settings: AppSettings }} PersistedState */

/**
 * @param {string} userDataPath
 */
export function createStore(userDataPath) {
  const stateDir = path.join(userDataPath, "mutatr-app");
  const stateFile = path.join(stateDir, "state.json");

  /** @type {PersistedState} */
  let state = { projects: [], settings: {} };
  /** @type {'none' | 'env' | 'plaintext'} */
  let apiKeyStorage = "none";
  let envApiKey = "";

  async function init() {
    await fs.mkdir(stateDir, { recursive: true });
    envApiKey = await resolveClaudeApiKeyFromEnv(userDataPath, stateDir);
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw);
      state.projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
      for (const project of state.projects) {
        if (!Array.isArray(project.experiments)) {
          project.experiments = [];
        }
      }
      const hydrated = hydrateSettings(parsed?.settings, envApiKey);
      state.settings = hydrated.settings;
      apiKeyStorage = hydrated.apiKeyStorage;
      if (hydrated.didRewriteSettings) {
        await persist();
      }
    } catch {
      await persist();
    }
  }

  async function persist() {
    const serialized = serializeSettings(state.settings, envApiKey);
    apiKeyStorage = serialized.apiKeyStorage;
    await fs.writeFile(
      stateFile,
      JSON.stringify({ projects: state.projects, settings: serialized.settings }, null, 2),
      "utf8"
    );
  }

  /** @returns {ProjectRecord[]} */
  function listProjects() {
    return [...state.projects];
  }

  /**
   * @param {ProjectRecord} project
   */
  async function upsertProject(project) {
    const idx = state.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      state.projects[idx] = project;
    } else {
      state.projects.push(project);
    }
    await persist();
  }

  /**
   * @param {string} projectId
   */
  function getProject(projectId) {
    return state.projects.find((p) => p.id === projectId) ?? null;
  }

  /**
   * @param {string} projectId
   */
  async function removeProject(projectId) {
    state.projects = state.projects.filter((p) => p.id !== projectId);
    await persist();
  }

  /** @returns {AppSettings} */
  function getSettings() {
    const claudeApiKey = envApiKey || state.settings.claudeApiKey;
    return {
      ...state.settings,
      claudeApiKey,
      apiKeyStorage: claudeApiKey ? apiKeyStorage : "none",
    };
  }

  /**
   * @param {AppSettings} updates
   */
  async function updateSettings(updates) {
    const nextSettings = {
      ...state.settings,
      ...updates,
    };
    if (envApiKey) {
      delete nextSettings.claudeApiKey;
    } else if (typeof nextSettings.claudeApiKey === "string") {
      const trimmed = nextSettings.claudeApiKey.trim();
      nextSettings.claudeApiKey = trimmed || undefined;
    }
    state.settings = nextSettings;
    apiKeyStorage = envApiKey
      ? "env"
      : state.settings.claudeApiKey
        ? "plaintext"
        : "none";
    await persist();
  }

  return {
    init,
    listProjects,
    upsertProject,
    getProject,
    removeProject,
    getSettings,
    updateSettings,
    getStateDir: () => stateDir,
  };
}

/**
 * @param {unknown} rawSettings
 * @param {string} envApiKey
 */
function hydrateSettings(rawSettings, envApiKey) {
  const next = rawSettings && typeof rawSettings === "object" ? { ...rawSettings } : {};
  const encryptedKey = typeof next.claudeApiKeyEncrypted === "string" ? next.claudeApiKeyEncrypted : "";
  const legacyPlaintextKey = typeof next.claudeApiKey === "string" ? next.claudeApiKey.trim() : "";
  /** @type {'none' | 'env' | 'plaintext'} */
  let nextApiKeyStorage = "none";
  let didRewriteSettings = false;

  delete next.claudeApiKeyEncrypted;
  delete next.apiKeyStorage;

  if (envApiKey) {
    delete next.claudeApiKey;
    nextApiKeyStorage = "env";
    didRewriteSettings = Boolean(encryptedKey || legacyPlaintextKey);
  } else if (legacyPlaintextKey) {
    next.claudeApiKey = legacyPlaintextKey;
    nextApiKeyStorage = "plaintext";
  } else if (encryptedKey) {
    try {
      next.claudeApiKey = safeStorage.decryptString(Buffer.from(encryptedKey, "base64"));
      nextApiKeyStorage = next.claudeApiKey ? "plaintext" : "none";
    } catch {
      next.claudeApiKey = undefined;
    }
    didRewriteSettings = true;
  } else {
    next.claudeApiKey = undefined;
  }

  return {
    settings: next,
    apiKeyStorage: envApiKey || next.claudeApiKey ? nextApiKeyStorage : "none",
    didRewriteSettings,
  };
}

/**
 * @param {AppSettings} settings
 * @param {string} envApiKey
 */
function serializeSettings(settings, envApiKey) {
  const next = { ...settings };
  const claudeApiKey = typeof next.claudeApiKey === "string" ? next.claudeApiKey.trim() : "";
  delete next.claudeApiKeyEncrypted;
  delete next.apiKeyStorage;

  if (envApiKey) {
    delete next.claudeApiKey;
    return { settings: next, apiKeyStorage: "env" };
  }

  if (!claudeApiKey) {
    delete next.claudeApiKey;
    return { settings: next, apiKeyStorage: "none" };
  }

  next.claudeApiKey = claudeApiKey;
  return { settings: next, apiKeyStorage: "plaintext" };
}

async function resolveClaudeApiKeyFromEnv(userDataPath, stateDir) {
  const directEnv = [
    process.env.MUTATR_CLAUDE_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.E2E_CLAUDE_API_KEY,
  ].find((value) => typeof value === "string" && value.trim());
  if (directEnv) return directEnv.trim();

  const candidateFiles = uniquePaths([
    process.env.MUTATR_ENV_FILE,
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(userDataPath, ".env.local"),
    path.join(userDataPath, ".env"),
    path.join(stateDir, ".env.local"),
    path.join(stateDir, ".env"),
  ]);

  for (const filePath of candidateFiles) {
    const key = await readClaudeApiKeyFromEnvFile(filePath);
    if (key) return key;
  }

  return "";
}

async function readClaudeApiKeyFromEnvFile(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return "";
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?(MUTATR_CLAUDE_API_KEY|ANTHROPIC_API_KEY|E2E_CLAUDE_API_KEY)\s*=\s*(.+?)\s*$/
      );
      if (!match) continue;
      return stripEnvQuotes(match[2]).trim();
    }
  } catch {
    return "";
  }
  return "";
}

function stripEnvQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function uniquePaths(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
