import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createStore } from "./services/store.mjs";
import {
  discoverPages,
  inferProjectName,
  normalizeProjectRoot,
} from "./services/projectService.mjs";
import {
  suggestPersonas,
  suggestTests,
  implementTest,
  predictAttentionBoxes,
  analyzeVariantScorecard,
} from "./services/claudeService.mjs";
import {
  renderHeatmapOverlay,
  renderPageThumbnails,
  renderVariant,
} from "./services/playwrightService.mjs";
import { DEFAULT_MODELS, normalizeModel } from "./services/modelPreferences.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ICON_PATH = path.join(__dirname, "../public/mutatr_logo.png");

const isDev = !app.isPackaged;
const AUTO_REPAIR_FALLBACK_LABEL_RE =
  /Unable to spin up a local dev server|Dev server failed to start on http:\/\/127\.0\.0\.1:4179|Render failed/i;

/** @type {ReturnType<typeof createStore> | null} */
let store = null;

/** @type {BrowserWindow | null} */
let mainWindow = null;
const backgroundPageRepairIds = new Set();

app.whenReady().then(async () => {
  store = createStore(resolveUserDataPath());
  await store.init();

  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(APP_ICON_PATH);
    app.dock.setIcon(dockIcon);
  }

  createWindow();
  registerIpc();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1200,
    minHeight: 780,
    backgroundColor: "#171717",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: "hiddenInset",
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    if (process.env.MUTATR_DISABLE_DEVTOOLS !== "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

/**
 * Send a progress event to the renderer.
 * @param {string} lineId
 * @param {string} label
 * @param {"running" | "done" | "error"} status
 * @param {string} tokenDelta
 * @param {string} [group]
 */
function sendProgress(lineId, label, status, tokenDelta = "", group = undefined) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("mutatr:progress", { lineId, label, status, tokenDelta, group });
    }
  } catch {
    // Window or frame disposed mid-operation — safe to ignore
  }
}

/**
 * Push a project update to the renderer.
 * @param {object} project
 */
function sendProjectUpdated(project) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("mutatr:project:updated", toClientProject(project));
    }
  } catch {
    // Window or frame disposed mid-operation — safe to ignore
  }
}

function registerIpc() {
  ipcMain.handle("mutatr:settings:get", async () => {
    ensureStore();
    const settings = store.getSettings();
    return success(toClientSettings(settings));
  });

  ipcMain.handle("mutatr:settings:update", async (_event, payload) => {
    ensureStore();
    /** @type {{claudeApiKey?: string; suggestionModel?: string; implementationModel?: string; personasModel?: string; attentionModel?: string}} */
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(payload ?? {}, "claudeApiKey")) {
      const nextValue = typeof payload?.claudeApiKey === "string" ? payload.claudeApiKey.trim() : "";
      updates.claudeApiKey = nextValue || undefined;
    }

    if (Object.prototype.hasOwnProperty.call(payload ?? {}, "suggestionModel")) {
      updates.suggestionModel = normalizeModel(payload?.suggestionModel);
    }

    if (Object.prototype.hasOwnProperty.call(payload ?? {}, "implementationModel")) {
      updates.implementationModel = normalizeModel(payload?.implementationModel);
    }

    if (Object.prototype.hasOwnProperty.call(payload ?? {}, "personasModel")) {
      updates.personasModel = normalizeModel(payload?.personasModel);
    }

    if (Object.prototype.hasOwnProperty.call(payload ?? {}, "attentionModel")) {
      updates.attentionModel = normalizeModel(payload?.attentionModel);
    }

    await store.updateSettings(updates);
    const settings = store.getSettings();
    return success(toClientSettings(settings));
  });

  ipcMain.handle("mutatr:projects:list", async () => {
    ensureStore();
    const projects = store.listProjects();
    queuePageRepairForProjects(projects);
    return success(projects.map(toClientProject));
  });

  ipcMain.handle("mutatr:projects:add", async (_event, selectedPath) => {
    ensureStore();

    try {
      const pickedPath =
        typeof selectedPath === "string" && selectedPath.trim()
          ? selectedPath.trim()
          : await promptForProjectPath();

      if (!pickedPath) {
        return failure("No project selected.");
      }

      const rootPath = await normalizeProjectRoot(pickedPath);
      const name = await inferProjectName(rootPath);
      const projectId = hash(rootPath);

      const skeleton = {
        id: projectId,
        name,
        rootPath,
        createdAt: new Date().toISOString(),
        pages: [],
        personas: [],
        experiments: [],
        lastUpdatedAt: new Date().toISOString(),
        status: "importing",
      };

      await store.upsertProject(skeleton);

      // Fire background setup without awaiting
      runProjectSetup(projectId).catch((err) => {
        console.error("runProjectSetup failed:", err);
      });

      return success(toClientProject(skeleton));
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Failed to add project.");
    }
  });

  ipcMain.handle("mutatr:projects:remove", async (_event, projectId) => {
    ensureStore();
    await store.removeProject(projectId);
    return success(true);
  });

  ipcMain.handle("mutatr:pages:refresh", async (_event, projectId) => {
    ensureStore();
    try {
      const project = await refreshProjectPages(projectId);
      return success(toClientProject(project));
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Failed to refresh pages.");
    }
  });

  ipcMain.handle("mutatr:personas:refresh", async (_event, projectId) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    try {
      const modelPrefs = getModelPreferences();
      const personas = await suggestPersonas({
        projectName: project.name,
        projectRoot: project.rootPath,
        pages: project.pages,
        apiKey: getClaudeApiKey(),
        model: modelPrefs.personasModel,
      });
      project.personas = personas;

      const imageDir = getProjectImageDir(project.rootPath);
      project.pages = await renderPageThumbnails({
        projectRoot: project.rootPath,
        pages: project.pages,
        personas,
        imageDir,
      });

      project.lastUpdatedAt = new Date().toISOString();
      await store.upsertProject(project);

      return success(personas);
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Failed to refresh personas.");
    }
  });

  ipcMain.handle("mutatr:personas:add", async (_event, projectId, payload) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    project.personas = [
      ...project.personas,
      {
        id: crypto.randomUUID().slice(0, 16),
        name: payload.name,
        summary: payload.summary,
        ageBand: payload.ageBand || "custom",
        motivations: payload.motivations || [],
        painPoints: payload.painPoints || [],
        tone: payload.tone || "neutral",
        preferredChannels: payload.preferredChannels || [],
      },
    ];

    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);

    return success(project.personas);
  });

  ipcMain.handle("mutatr:experiments:create", async (_event, projectId, name) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    const experiment = {
      id: crypto.randomUUID().slice(0, 16),
      name,
      pageId: null,
      goal: null,
      createdAt: new Date().toISOString(),
      tests: [],
      renders: [],
      attention: null,
    };

    if (!project.experiments) project.experiments = [];
    project.experiments.push(experiment);
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);

    return success(toClientProject(project));
  });

  ipcMain.handle("mutatr:experiments:delete", async (_event, projectId, experimentId) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    project.experiments = (project.experiments ?? []).filter((e) => e.id !== experimentId);
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);

    return success(toClientProject(project));
  });

  ipcMain.handle("mutatr:experiments:set-page", async (_event, projectId, experimentId, pageId) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    const experiment = (project.experiments ?? []).find((e) => e.id === experimentId);
    if (!experiment) return failure("Experiment not found.");

    experiment.pageId = pageId;
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);

    return success(toClientProject(project));
  });

  ipcMain.handle("mutatr:experiments:set-goal", async (_event, projectId, experimentId, goal) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    const experiment = (project.experiments ?? []).find((e) => e.id === experimentId);
    if (!experiment) return failure("Experiment not found.");

    experiment.goal = typeof goal === "string" && goal.trim() ? goal.trim() : null;
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);

    return success(toClientProject(project));
  });

  ipcMain.handle("mutatr:pages:suggest-tests", async (_event, projectId, experimentId) => {
    ensureStore();
    const project = store.getProject(projectId);
    if (!project) return failure("Project not found.");

    const experiment = (project.experiments ?? []).find((e) => e.id === experimentId);
    if (!experiment) return failure("Experiment not found.");

    const page = project.pages.find((p) => p.id === experiment.pageId);
    if (!page) return failure("Page not found. Assign a page to the experiment first.");

    try {
      const pageSource = await safeRead(page.filePath);
      const modelPrefs = getModelPreferences();
      const suggestLineId = `suggest-${experiment.id}`;
      sendProgress(suggestLineId, `Suggesting tests for ${page.route}`, "running");
      const tests = await suggestTests({
        projectRoot: project.rootPath,
        projectName: project.name,
        page,
        pageSource,
        personas: project.personas,
        goal: experiment.goal || undefined,
        apiKey: getClaudeApiKey(),
        model: modelPrefs.suggestionModel,
        onMessage: (text) => sendProgress(suggestLineId, `Suggesting tests for ${page.route}`, "running", text),
      });
      sendProgress(suggestLineId, `Suggesting tests for ${page.route}`, "done");

      experiment.tests = tests;
      project.lastUpdatedAt = new Date().toISOString();
      await store.upsertProject(project);

      return success(tests);
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Failed to suggest tests.");
    }
  });

  ipcMain.handle(
    "mutatr:pages:implement-tests",
    async (_event, projectId, experimentId, selectedTestIds) => {
      ensureStore();
      const project = store.getProject(projectId);
      if (!project) return failure("Project not found.");

      const experiment = (project.experiments ?? []).find((e) => e.id === experimentId);
      if (!experiment) return failure("Experiment not found.");

      const page = project.pages.find((p) => p.id === experiment.pageId);
      if (!page) return failure("Page not found.");

      const pageTests = experiment.tests ?? [];
      const selectedTests = pageTests.filter((t) => selectedTestIds.includes(t.id));

      if (!selectedTests.length) {
        return failure("No tests selected.");
      }

      const imageDir = getProjectImageDir(project.rootPath);
      const modelPrefs = getModelPreferences();

      // Phase 1: Run all implementations in parallel, each on its own temp copy
      const implResults = await Promise.all(
        selectedTests.map(async (test, i) => {
          const tempRoot = path.join(os.tmpdir(), `mutatr-impl-${crypto.randomUUID().slice(0, 8)}`);
          const lineId = `impl-${test.id}`;
          sendProgress(lineId, `Implementing: ${test.title}`, "running");
          try {
            await copyProjectLight(project.rootPath, tempRoot);
            const pageFilePath = normalizeProjectRelativePath(page.filePath, project.rootPath);
            if (!pageFilePath) {
              throw new Error(`Selected page is outside the imported project: ${page.filePath}`);
            }
            const impl = await implementTest({
              projectRoot: tempRoot,
              page: {
                ...page,
                filePath: pageFilePath,
              },
              test,
              apiKey: getClaudeApiKey(),
              model: modelPrefs.implementationModel,
              onMessage: (text) => sendProgress(lineId, `Implementing: ${test.title}`, "running", text),
            });
            const normalizedChangedFiles = normalizeChangedFiles(impl.changedFiles, tempRoot);
            const detectedProjectChanges = await detectProjectFileChanges(project.rootPath, tempRoot);
            const detectedChangedFiles = uniquePaths([
              ...detectedProjectChanges.changedFiles,
              ...detectedProjectChanges.deletedFiles,
            ]);
            if (!detectedChangedFiles.length) {
              if (normalizedChangedFiles.rejected.length > 0) {
                throw new Error(
                  `Implementation reported unsafe file paths and produced no detectable project edits: ${normalizedChangedFiles.rejected.slice(0, 3).join(", ")}`
                );
              }
              if (normalizedChangedFiles.normalized.length > 0) {
                throw new Error(
                  `Implementation reported changed files but produced no detectable project edits: ${normalizedChangedFiles.normalized.slice(0, 3).join(", ")}`
                );
              }
              throw new Error("Implementation did not produce any detectable file changes inside the project copy.");
            }
            sendProgress(lineId, `Implementing: ${test.title}`, "done");
            return {
              test,
              impl: {
                ...impl,
                changedFiles: detectedChangedFiles,
              },
              tempRoot,
              ok: true,
            };
          } catch (error) {
            console.error(error);
            sendProgress(lineId, `Implementing: ${test.title}`, "error");
            return { test, impl: null, tempRoot, ok: false };
          }
        })
      );

      // Phase 2: Render variants sequentially from each isolated temp copy.
      /** @type {import('./services/types.mjs').RenderRecord[]} */
      const renders = [];

      for (const result of implResults) {
        const renderLineId = `render-${result.test.id}`;
        if (result.ok && result.impl && result.impl.changedFiles?.length) {
          sendProgress(renderLineId, `Rendering: ${result.test.title}`, "running");
          try {
            const capture = await renderVariant({
              projectRoot: result.tempRoot,
              route: page.route,
              imageDir,
              label: `${page.route} - ${result.test.title}`,
            });
            // Snapshot changed file contents from temp before cleanup
            /** @type {Record<string, string|null>} */
            const changedFileContents = {};
            for (const rel of result.impl.changedFiles) {
              const changedFilePath = path.join(result.tempRoot, rel);
              try {
                await fs.access(changedFilePath);
                changedFileContents[rel] = await fs.readFile(changedFilePath, "utf8");
              } catch {
                changedFileContents[rel] = null;
              }
            }

            renders.push({
              id: crypto.randomUUID().slice(0, 16),
              testId: result.test.id,
              title: result.test.title,
              route: page.route,
              screenshotDataUrl: capture.screenshotDataUrl,
              screenshotPath: capture.screenshotPath,
              mobileScreenshotDataUrl: capture.mobileScreenshotDataUrl,
              mobileScreenshotPath: capture.mobileScreenshotPath,
              changedFiles: [...result.impl.changedFiles],
              changedFileContents,
              attentionAnchors: capture.attentionAnchors,
              mobileAttentionAnchors: capture.mobileAttentionAnchors,
            });
            sendProgress(renderLineId, `Rendering: ${result.test.title}`, "done");
          } catch (error) {
            console.error(error);
            renders.push({
              id: crypto.randomUUID().slice(0, 16),
              testId: result.test.id,
              title: `${result.test.title} (failed)`,
              route: page.route,
              screenshotDataUrl: page.thumbnailDataUrl,
              mobileScreenshotDataUrl: page.mobileScreenshotDataUrl,
              changedFiles: [],
            });
            sendProgress(renderLineId, `Rendering: ${result.test.title}`, "error");
          }
        } else {
          renders.push({
            id: crypto.randomUUID().slice(0, 16),
            testId: result.test.id,
            title: `${result.test.title} (failed)`,
            route: page.route,
            screenshotDataUrl: page.thumbnailDataUrl,
            mobileScreenshotDataUrl: page.mobileScreenshotDataUrl,
            changedFiles: [],
          });
          sendProgress(renderLineId, `Rendering: ${result.test.title}`, "error");
        }
      }

      // Phase 3: Cleanup temp copies
      for (const result of implResults) {
        fs.rm(result.tempRoot, { recursive: true, force: true }).catch(() => {});
      }

      experiment.renders = renders;
      project.lastUpdatedAt = new Date().toISOString();
      await store.upsertProject(project);

      return success(renders);
    }
  );

  ipcMain.handle(
    "mutatr:pages:run-attention",
    async (_event, projectId, experimentId, renderIds, personaIds, visitors) => {
      ensureStore();
      const project = store.getProject(projectId);
      if (!project) return failure("Project not found.");

      const experiment = (project.experiments ?? []).find((e) => e.id === experimentId);
      if (!experiment) return failure("Experiment not found.");

      const page = project.pages.find((p) => p.id === experiment.pageId);
      if (!page) return failure("Page not found.");

      const selectedRenders = (experiment.renders ?? []).filter((r) => renderIds.includes(r.id));
      if (!selectedRenders.length) return failure("No renders selected.");

      const selectedPersonas = project.personas.filter((p) => personaIds.includes(p.id));
      if (!selectedPersonas.length) return failure("No personas selected.");

      const visitorCount = typeof visitors === "number" && visitors > 0 ? visitors : 10;
      const modelPrefs = getModelPreferences();
      const imageDir = getProjectImageDir(project.rootPath);

      try {
        /** @type {Record<string, object>} */
        const heatmaps = {};
        /** @type {Record<string, object>} */
        const controlHeatmaps = {};

        for (const persona of selectedPersonas) {
          // Control heatmap (original page)
          const controlGroup = `${page.route}: Control`;
          const controlLineId = `attn-ctrl-${persona.id}`;
          sendProgress(controlLineId, persona.name, "running", "", controlGroup);
          const controlAttention = await predictAttentionBoxes({
            projectRoot: project.rootPath,
            pageRoute: page.route,
            persona,
            variantTitle: "Control (original page)",
            screenshotPath: page.screenshotPath,
            screenshotDataUrl: page.thumbnailDataUrl,
            anchors: page.attentionAnchors ?? [],
            visitors: visitorCount,
            apiKey: getClaudeApiKey(),
            model: modelPrefs.attentionModel,
            onMessage: (text) => sendProgress(controlLineId, persona.name, "running", text, controlGroup),
          });

          const controlHeatmapDataUrl = await renderHeatmapOverlay({
            baseImageDataUrl: page.thumbnailDataUrl ?? "",
            boxes: controlAttention.boxes,
            imageDir,
          });

          controlHeatmaps[persona.id] = {
            rationale: controlAttention.rationale,
            boxes: controlAttention.boxes,
            heatmapDataUrl: controlHeatmapDataUrl,
          };
          sendProgress(controlLineId, persona.name, "done", "", controlGroup);

          // Variant heatmaps
          for (const render of selectedRenders) {
            const variantGroup = `${page.route}: ${render.title}`;
            const variantLineId = `attn-${render.id}-${persona.id}`;
            sendProgress(variantLineId, persona.name, "running", "", variantGroup);
            const variantAttention = await predictAttentionBoxes({
              projectRoot: project.rootPath,
              pageRoute: page.route,
              persona,
              variantTitle: render.title,
              screenshotPath: render.screenshotPath,
              screenshotDataUrl: render.screenshotDataUrl,
              anchors: render.attentionAnchors ?? [],
              visitors: visitorCount,
              apiKey: getClaudeApiKey(),
              model: modelPrefs.attentionModel,
              onMessage: (text) => sendProgress(variantLineId, persona.name, "running", text, variantGroup),
            });

            const variantHeatmapDataUrl = await renderHeatmapOverlay({
              baseImageDataUrl: render.screenshotDataUrl ?? page.thumbnailDataUrl ?? "",
              boxes: variantAttention.boxes,
              imageDir,
            });

            const scorecardGroup = `${page.route}: ${render.title}`;
            const scorecardLineId = `score-${render.id}-${persona.id}`;
            sendProgress(scorecardLineId, `${persona.name} scorecard`, "running", "", scorecardGroup);
            const scorecard = await analyzeVariantScorecard({
              projectRoot: project.rootPath,
              pageRoute: page.route,
              persona,
              variantTitle: render.title,
              goal: experiment.goal ?? null,
              controlScreenshotPath: page.screenshotPath,
              controlScreenshotDataUrl: page.thumbnailDataUrl,
              controlMobileScreenshotPath: page.mobileScreenshotPath,
              controlMobileScreenshotDataUrl: page.mobileScreenshotDataUrl,
              controlAnchors: page.attentionAnchors ?? [],
              controlMobileAnchors: page.mobileAttentionAnchors ?? [],
              controlBoxes: controlAttention.boxes,
              variantScreenshotPath: render.screenshotPath,
              variantScreenshotDataUrl: render.screenshotDataUrl,
              variantMobileScreenshotPath: render.mobileScreenshotPath,
              variantMobileScreenshotDataUrl: render.mobileScreenshotDataUrl,
              variantAnchors: render.attentionAnchors ?? [],
              variantMobileAnchors: render.mobileAttentionAnchors ?? [],
              variantBoxes: variantAttention.boxes,
              changedFiles: render.changedFiles ?? [],
              apiKey: getClaudeApiKey(),
              model: modelPrefs.attentionModel,
              onMessage: (text) => sendProgress(scorecardLineId, `${persona.name} scorecard`, "running", text, scorecardGroup),
            });
            sendProgress(scorecardLineId, `${persona.name} scorecard`, "done", "", scorecardGroup);

            heatmaps[`${render.id}__${persona.id}`] = {
              rationale: variantAttention.rationale,
              boxes: variantAttention.boxes,
              heatmapDataUrl: variantHeatmapDataUrl,
              scorecard,
            };
            sendProgress(variantLineId, persona.name, "done", "", variantGroup);
          }
        }

        const variantSummaries = summarizeVariantScorecards(heatmaps, selectedRenders);
        const attentionResult = { heatmaps, controlHeatmaps, variantSummaries };

        experiment.attention = attentionResult;
        project.lastUpdatedAt = new Date().toISOString();
        await store.upsertProject(project);

        return success(attentionResult);
      } catch (error) {
        return failure(error instanceof Error ? error.message : "Failed to run attention test.");
      }
    }
  );

  ipcMain.handle(
    "mutatr:experiments:push-render-pr",
    async (_event, projectId, experimentId, renderId) => {
      ensureStore();
      const project = store.getProject(projectId);
      if (!project) return failure("Project not found.");

      const experiment = (project.experiments ?? []).find((e) => e.id === experimentId);
      if (!experiment) return failure("Experiment not found.");

      const render = (experiment.renders ?? []).find((r) => r.id === renderId);
      if (!render) return failure("Render not found.");

      const test = (experiment.tests ?? []).find((t) => t.id === render.testId);
      if (!test) return failure("Test not found for this render.");

      if (!render.changedFileContents || Object.keys(render.changedFileContents).length === 0) {
        return failure("No saved file contents for this variant. Re-run the implementation first.");
      }

      const projectRoot = project.rootPath;

      // Verify project is a git repo
      try {
        await runCommand(projectRoot, "git", ["rev-parse", "--is-inside-work-tree"]);
      } catch {
        return failure("Project is not a git repository. Initialize git first.");
      }

      // Refuse if working tree is dirty
      try {
        const status = await runCommand(projectRoot, "git", ["status", "--porcelain"]);
        if (status.length > 0) {
          return failure("Project has uncommitted changes. Commit or stash them before pushing a PR.");
        }
      } catch {
        return failure("Failed to check git status.");
      }

      const branchName = `mutatr/${slugify(experiment.name)}/${slugify(render.title)}`;
      const commitMsg = `[mutatr] ${experiment.name}: ${render.title}\n\nExperiment: ${experiment.name}\nTreatment: ${render.title}\nHypothesis: ${test.hypothesis}`;
      const prTitle = `[mutatr] ${render.title}`;
      const prBody = `## Mutatr Experiment\n\n**Experiment:** ${experiment.name}\n**Treatment:** ${render.title}\n**Hypothesis:** ${test.hypothesis}\n**Expected Impact:** ${test.expectedImpact}\n\n---\n_Created by [mutatr](https://github.com/mutatr)_`;

      let originalBranch = "";

      try {
        const gitLineId = `pr-git-${renderId}`;
        sendProgress(gitLineId, "Creating branch and PR", "running");

        // Save the current branch name
        originalBranch = await runCommand(projectRoot, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);

        // Create and checkout new branch
        await runCommand(projectRoot, "git", ["checkout", "-b", branchName]);

        // Write saved file contents to the project
        const sanitizedFileContents = sanitizeChangedFileContents(render.changedFileContents, projectRoot);
        if (sanitizedFileContents.rejected.length > 0) {
          throw new Error(
            `Refusing to write unsafe variant files: ${sanitizedFileContents.rejected.slice(0, 3).join(", ")}`
          );
        }
        const relPaths = Object.keys(sanitizedFileContents.files);
        if (!relPaths.length) {
          throw new Error("No variant files were eligible to write back into the project.");
        }
        for (const rel of relPaths) {
          const destFile = path.join(projectRoot, rel);
          const content = sanitizedFileContents.files[rel];
          if (content === null) {
            await fs.rm(destFile, { force: true });
            continue;
          }
          await fs.mkdir(path.dirname(destFile), { recursive: true });
          await fs.writeFile(destFile, content, "utf8");
        }

        // Stage, commit, push
        await runCommand(projectRoot, "git", ["add", "-A", "--", ...relPaths]);
        await runCommand(projectRoot, "git", ["commit", "-m", commitMsg]);
        await runCommand(projectRoot, "git", ["push", "-u", "origin", branchName]);

        // Create PR
        const prUrl = await runCommand(projectRoot, "gh", ["pr", "create", "--title", prTitle, "--body", prBody]);

        sendProgress(gitLineId, "Creating branch and PR", "done");

        // Return to original branch (git restores the working tree)
        await runCommand(projectRoot, "git", ["checkout", originalBranch]);

        return success({ prUrl });
      } catch (error) {
        // Best-effort restore to original branch
        if (originalBranch) {
          await runCommand(projectRoot, "git", ["checkout", originalBranch]).catch(() => {});
        }

        const errLineId = `pr-git-${renderId}`;
        sendProgress(errLineId, "Creating branch and PR", "error");
        return failure(error instanceof Error ? error.message : "Failed to push render as PR.");
      }
    }
  );
}

/**
 * Run background setup for a newly imported project.
 * Discovers pages, suggests personas, renders thumbnails, then marks ready.
 * @param {string} projectId
 */
async function runProjectSetup(projectId) {
  ensureStore();
  const setupGroup = "Project setup";

  try {
    const project = store.getProject(projectId);
    if (!project) return;

    // 1. Discover pages
    const pagesLineId = `setup-pages-${projectId}`;
    sendProgress(pagesLineId, "Discovering pages", "running", "", setupGroup);
    const pages = await discoverPages(project.rootPath);
    project.pages = pages;
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);
    sendProjectUpdated(project);
    sendProgress(pagesLineId, `Discovered ${pages.length} pages`, "done", "", setupGroup);

    // 2. Suggest personas
    const personasLineId = `setup-personas-${projectId}`;
    sendProgress(personasLineId, "Generating personas", "running", "", setupGroup);
    const claudeApiKey = getClaudeApiKey();
    const modelPrefs = getModelPreferences();
    const personas = await suggestPersonas({
      projectName: project.name,
      projectRoot: project.rootPath,
      pages: project.pages,
      apiKey: claudeApiKey,
      model: modelPrefs.personasModel,
      onMessage: (text) => sendProgress(personasLineId, "Generating personas", "running", text, setupGroup),
    });
    project.personas = personas;
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);
    sendProjectUpdated(project);
    sendProgress(personasLineId, `Generated ${personas.length} personas`, "done", "", setupGroup);

    // 3. Render thumbnails
    const thumbsLineId = `setup-thumbs-${projectId}`;
    sendProgress(thumbsLineId, "Rendering thumbnails", "running", "", setupGroup);
    const imageDir = getProjectImageDir(project.rootPath);
    const pagesWithThumbs = await renderPageThumbnails({
      projectRoot: project.rootPath,
      pages: project.pages,
      personas: project.personas,
      imageDir,
    });
    project.pages = pagesWithThumbs;
    project.status = "ready";
    project.lastUpdatedAt = new Date().toISOString();
    await store.upsertProject(project);
    sendProjectUpdated(project);
    sendProgress(thumbsLineId, "Thumbnails rendered", "done", "", setupGroup);
  } catch (error) {
    console.error("Project setup error:", error);
    const errLineId = `setup-error-${projectId}`;
    sendProgress(errLineId, error instanceof Error ? error.message : "Setup failed", "error", "", setupGroup);
    // Mark as ready even on error so the project is usable
    const project = store.getProject(projectId);
    if (project) {
      project.status = "ready";
      project.lastUpdatedAt = new Date().toISOString();
      await store.upsertProject(project);
      sendProjectUpdated(project);
    }
  }
}

/**
 * @param {string} projectId
 */
async function refreshProjectPages(projectId) {
  ensureStore();
  const project = store.getProject(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const discoveredPages = await discoverPages(project.rootPath);
  let personas = project.personas;

  if (!personas.length) {
    const modelPrefs = getModelPreferences();
    personas = await suggestPersonas({
      projectName: project.name,
      projectRoot: project.rootPath,
      pages: discoveredPages,
      apiKey: getClaudeApiKey(),
      model: modelPrefs.personasModel,
    });
  }

  const pagesWithThumbs = await renderPageThumbnails({
    projectRoot: project.rootPath,
    pages: discoveredPages,
    personas,
    imageDir: getProjectImageDir(project.rootPath),
  });

  const previousPageByRoute = new Map(project.pages.map((page) => [page.route, page]));
  const oldIdToNewId = new Map();
  for (const page of pagesWithThumbs) {
    const prevPage = previousPageByRoute.get(page.route);
    if (prevPage) oldIdToNewId.set(prevPage.id, page.id);
  }

  for (const experiment of project.experiments ?? []) {
    if (experiment.pageId && oldIdToNewId.has(experiment.pageId)) {
      experiment.pageId = oldIdToNewId.get(experiment.pageId);
    } else if (experiment.pageId && !oldIdToNewId.has(experiment.pageId)) {
      experiment.pageId = null;
    }
  }

  project.personas = personas;
  project.pages = pagesWithThumbs;
  project.lastUpdatedAt = new Date().toISOString();
  await store.upsertProject(project);
  return project;
}

/**
 * @param {any[]} projects
 */
function queuePageRepairForProjects(projects) {
  for (const project of projects) {
    if (!projectNeedsPageRepair(project)) continue;
    if (backgroundPageRepairIds.has(project.id)) continue;

    backgroundPageRepairIds.add(project.id);
    refreshProjectPages(project.id)
      .then((updatedProject) => {
        sendProjectUpdated(updatedProject);
      })
      .catch((error) => {
        console.error(`Background page repair failed for ${project.id}:`, error);
      })
      .finally(() => {
        backgroundPageRepairIds.delete(project.id);
      });
  }
}

/**
 * @param {any} project
 */
function projectNeedsPageRepair(project) {
  return (
    project?.status === "ready"
    && Array.isArray(project?.pages)
    && project.pages.some((page) => pageLooksLikeFallback(page))
  );
}

/**
 * @param {any} page
 */
function pageLooksLikeFallback(page) {
  if (!page || !Array.isArray(page.attentionAnchors)) return false;
  return page.attentionAnchors.some((anchor) =>
    AUTO_REPAIR_FALLBACK_LABEL_RE.test(String(anchor?.label ?? ""))
  );
}

async function promptForProjectPath() {
  const selection = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "Select project folder or a file inside it",
    properties: ["openDirectory", "openFile", "dontAddToRecent"],
  });

  if (selection.canceled || !selection.filePaths.length) {
    return "";
  }

  return selection.filePaths[0];
}

function ensureStore() {
  if (!store) {
    throw new Error("Store not initialized");
  }
}

function resolveUserDataPath() {
  if (process.env.MUTATR_USER_DATA_DIR) {
    return path.resolve(process.env.MUTATR_USER_DATA_DIR);
  }
  return app.getPath("userData");
}

/**
 * @param {string} projectRoot
 */
function getProjectImageDir(projectRoot) {
  ensureStore();
  return path.join(store.getStateDir(), "images", hash(projectRoot));
}

function getClaudeApiKey() {
  ensureStore();
  const settings = store.getSettings();
  return settings.claudeApiKey;
}

function getModelPreferences() {
  ensureStore();
  const settings = store.getSettings();
  return {
    suggestionModel: normalizeModel(settings.suggestionModel) || DEFAULT_MODELS.suggestionModel,
    implementationModel: normalizeModel(settings.implementationModel) || DEFAULT_MODELS.implementationModel,
    personasModel: normalizeModel(settings.personasModel) || DEFAULT_MODELS.personasModel,
    attentionModel: normalizeModel(settings.attentionModel) || DEFAULT_MODELS.attentionModel,
  };
}

/**
 * @param {string} filePath
 */
async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {any} payload
 */
function success(payload) {
  return { ok: true, payload };
}

/**
 * @param {string} message
 */
function failure(message) {
  return { ok: false, error: message };
}

/**
 * @param {{claudeApiKey?:string; suggestionModel?:string; implementationModel?:string; personasModel?:string; attentionModel?:string}} settings
 */
function toClientSettings(settings) {
  return {
    hasClaudeApiKey: Boolean(settings.claudeApiKey),
    maskedClaudeApiKey: maskApiKey(settings.claudeApiKey),
    apiKeyStorage: settings.apiKeyStorage || "none",
    suggestionModel: settings.suggestionModel || "inherit",
    implementationModel: settings.implementationModel || "inherit",
    personasModel: settings.personasModel || "inherit",
    attentionModel: settings.attentionModel || "inherit",
  };
}

/**
 * @param {string} input
 */
function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

/**
 * @param {any} project
 */
function toClientProject(project) {
  return {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    createdAt: project.createdAt,
    pages: project.pages,
    personas: project.personas,
    experiments: project.experiments ?? [],
    lastUpdatedAt: project.lastUpdatedAt,
    status: project.status || "ready",
  };
}

/**
 * @param {Record<string, {scorecard?: any}>} heatmaps
 * @param {Array<{id:string}>} renders
 */
function summarizeVariantScorecards(heatmaps, renders) {
  const metricKeys = [
    "messageClarity",
    "ctaClarity",
    "trustVisibility",
    "distractionControl",
    "informationHierarchy",
    "personaFit",
    "frictionReduction",
    "accessibilitySafety",
    "mobileResilience",
    "performanceSafety",
  ];

  /** @type {Record<string, any>} */
  const summaries = {};

  for (const render of renders) {
    const tupleScorecards = Object.entries(heatmaps)
      .filter(([key, payload]) => key.startsWith(`${render.id}__`) && payload?.scorecard)
      .map(([key, payload]) => ({
        personaId: key.split("__")[1],
        scorecard: payload.scorecard,
      }));

    if (!tupleScorecards.length) continue;

    const metrics = {};
    for (const metricKey of metricKeys) {
      const metricScores = tupleScorecards
        .map(({ scorecard }) => scorecard.metrics?.[metricKey])
        .filter(Boolean);

      const scores = metricScores.map((metric) => Number(metric.score || 0));
      const deltas = metricScores.map((metric) => Number(metric.deltaFromControl || 0));
      const avgScore = averageNumeric(scores);
      const avgDelta = averageNumeric(deltas);
      metrics[metricKey] = {
        score: Math.round(avgScore),
        deltaFromControl: Math.round(avgDelta),
        spread: Math.round(scoreSpread(scores)),
      };
    }

    const overallScores = tupleScorecards.map(({ scorecard }) => Number(scorecard.overallScore || 0));
    const avgOverall = averageNumeric(overallScores);
    const avgDelta = averageNumeric(tupleScorecards.map(({ scorecard }) => Number(scorecard.deltaFromControl || 0)));
    const goalScores = tupleScorecards.map(({ scorecard }) => Number(scorecard.goalAlignment?.score || 0));
    const goalDeltas = tupleScorecards.map(({ scorecard }) => Number(scorecard.goalAlignment?.deltaFromControl || 0));
    const consistencyScore = Math.round(Math.max(0, 100 - scoreSpread(overallScores) * 1.6));
    const sortedByOverall = [...tupleScorecards].sort((a, b) => (b.scorecard.overallScore || 0) - (a.scorecard.overallScore || 0));
    const strongest = sortedByOverall[0];
    const weakest = sortedByOverall[sortedByOverall.length - 1];
    const goalAlignment = buildAggregateGoalAlignment(tupleScorecards, goalScores, goalDeltas);

    summaries[render.id] = {
      summary: buildAggregateSummary(render.title, tupleScorecards),
      overallScore: Math.round(avgOverall),
      averageDeltaFromControl: Math.round(avgDelta),
      goalAlignment,
      consistencyScore,
      bestPersonaId: strongest?.personaId ?? null,
      weakestPersonaId: weakest?.personaId ?? null,
      strengths: topAggregateBullets(tupleScorecards, "strengths"),
      risks: topAggregateBullets(tupleScorecards, "risks"),
      recommendations: topAggregateBullets(tupleScorecards, "recommendations"),
      issues: aggregateIssues(tupleScorecards),
      diff: aggregateDiff(tupleScorecards, render.title, goalAlignment),
      metrics,
    };
  }

  return summaries;
}

/**
 * @param {string} renderTitle
 * @param {Array<{personaId:string; scorecard:any}>} tupleScorecards
 */
function buildAggregateSummary(renderTitle, tupleScorecards) {
  const overall = averageNumeric(tupleScorecards.map(({ scorecard }) => Number(scorecard.overallScore || 0)));
  const avgDelta = averageNumeric(tupleScorecards.map(({ scorecard }) => Number(scorecard.deltaFromControl || 0)));
  const profile =
    avgDelta >= 6
      ? "looks directionally stronger than control across the tested personas"
      : avgDelta <= -6
        ? "looks directionally weaker than control across the tested personas"
        : "is mixed across the tested personas and needs tighter iteration";

  return `${renderTitle} ${profile}. Aggregate score ${Math.round(overall)} with an average ${avgDelta >= 0 ? "+" : ""}${Math.round(avgDelta)} point delta versus control.`;
}

/**
 * @param {Array<{personaId:string; scorecard:any}>} tupleScorecards
 * @param {"strengths"|"risks"|"recommendations"} field
 */
function topAggregateBullets(tupleScorecards, field) {
  const counts = new Map();
  for (const { scorecard } of tupleScorecards) {
    for (const line of scorecard?.[field] ?? []) {
      const key = String(line || "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([line]) => line);
}

function buildAggregateGoalAlignment(tupleScorecards, goalScores, goalDeltas) {
  const firstGoalAlignment = tupleScorecards[0]?.scorecard?.goalAlignment;
  const score = Math.round(averageNumeric(goalScores));
  const deltaFromControl = Math.round(averageNumeric(goalDeltas));
  const priorityMetrics = Array.isArray(firstGoalAlignment?.priorityMetrics)
    ? firstGoalAlignment.priorityMetrics
    : [];
  const priorityLabelList = priorityMetrics.map(formatMetricKey).join(", ");

  let summary = firstGoalAlignment?.summary || "No explicit goal set for this experiment.";
  if (firstGoalAlignment?.goal) {
    summary = deltaFromControl >= 6
      ? `Across personas, this variant supports "${firstGoalAlignment.goal}" with emphasis on ${priorityLabelList}.`
      : deltaFromControl <= -6
        ? `Across personas, this variant works against "${firstGoalAlignment.goal}" on the most important metrics.`
        : `Across personas, this variant is mixed against "${firstGoalAlignment.goal}" because the priority metrics are not consistently better than control.`;
  }

  return {
    goal: firstGoalAlignment?.goal ?? null,
    summary,
    score,
    deltaFromControl,
    priorityMetrics,
  };
}

function aggregateIssues(tupleScorecards) {
  const severityRank = { low: 1, medium: 2, high: 3 };
  const byTitle = new Map();

  for (const { scorecard } of tupleScorecards) {
    for (const issue of scorecard?.issues ?? []) {
      const title = String(issue?.title ?? "").trim();
      if (!title) continue;
      const existing = byTitle.get(title);
      const severity = issue?.severity === "high" || issue?.severity === "medium" ? issue.severity : "low";
      if (!existing) {
        byTitle.set(title, {
          count: 1,
          severity,
          description: String(issue?.description ?? "").trim(),
          recommendation: String(issue?.recommendation ?? "").trim(),
          metricKey: issue?.metricKey,
        });
        continue;
      }
      existing.count += 1;
      if (severityRank[severity] > severityRank[existing.severity]) existing.severity = severity;
      if (!existing.description && issue?.description) existing.description = String(issue.description).trim();
      if (!existing.recommendation && issue?.recommendation) existing.recommendation = String(issue.recommendation).trim();
      if (!existing.metricKey && issue?.metricKey) existing.metricKey = issue.metricKey;
    }
  }

  return [...byTitle.entries()]
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return severityRank[b[1].severity] - severityRank[a[1].severity];
    })
    .slice(0, 4)
    .map(([title, value]) => ({
      title,
      severity: value.severity,
      description: value.description || "This issue shows up across personas in the current variant.",
      recommendation: value.recommendation || "Iterate this area before trusting the variant.",
      metricKey: value.metricKey,
    }));
}

function aggregateDiff(tupleScorecards, renderTitle, goalAlignment) {
  const byTitle = new Map();

  for (const { scorecard } of tupleScorecards) {
    for (const change of scorecard?.diff?.changes ?? []) {
      const title = String(change?.title ?? "").trim();
      if (!title) continue;
      const existing = byTitle.get(title);
      if (!existing) {
        byTitle.set(title, {
          count: 1,
          type: change?.type || "layout",
          description: String(change?.description ?? "").trim(),
          positive: change?.impact === "positive" ? 1 : 0,
          negative: change?.impact === "negative" ? 1 : 0,
        });
        continue;
      }
      existing.count += 1;
      if (!existing.description && change?.description) existing.description = String(change.description).trim();
      if (change?.impact === "positive") existing.positive += 1;
      else if (change?.impact === "negative") existing.negative += 1;
    }
  }

  const changes = [...byTitle.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 4)
    .map(([title, value]) => ({
      title,
      type: value.type,
      impact: value.positive > value.negative ? "positive" : value.negative > value.positive ? "negative" : "mixed",
      description: value.description || "This change theme appears repeatedly across persona comparisons.",
    }));

  const summary = changes.length
    ? `${renderTitle} most consistently differs from control through ${changes.slice(0, 3).map((change) => change.title.toLowerCase()).join(", ")}.`
    : `${renderTitle} stays fairly close to control across the tested personas.`;

  const likelyImpact = goalAlignment.goal
    ? goalAlignment.deltaFromControl >= 6
      ? `Across personas, these changes are directionally supportive of "${goalAlignment.goal}".`
      : goalAlignment.deltaFromControl <= -6
        ? `Across personas, these changes are directionally risky for "${goalAlignment.goal}".`
        : `Across personas, these changes are mixed relative to "${goalAlignment.goal}".`
    : goalAlignment.deltaFromControl >= 6
      ? "Across personas, these changes look directionally stronger than control."
      : goalAlignment.deltaFromControl <= -6
        ? "Across personas, these changes look directionally weaker than control."
        : "Across personas, these changes are mixed against control.";

  return {
    summary,
    likelyImpact,
    changes,
  };
}

function formatMetricKey(metricKey) {
  return String(metricKey ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function averageNumeric(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function scoreSpread(values) {
  if (values.length <= 1) return 0;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max - min;
}

/**
 * Run a subprocess and return its stdout.
 * @param {string} cwd
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function runCommand(cwd, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed (exit ${code}): ${command} ${args.join(" ")}\n${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.on("error", reject);
  });
}

/**
 * Slugify a string for use in git branch names.
 * @param {string} input
 * @returns {string}
 */
function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const COPY_EXCLUDE = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", ".turbo"]);

/**
 * Lightweight project copy: skips heavy dirs (no node_modules, no .git).
 * Used only for Claude agent edits — no bundler will run here.
 * @param {string} src
 * @param {string} dest
 */
async function copyProjectLight(src, dest) {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(path.basename(source)),
  });
  await linkSharedDirectory(src, dest, "node_modules");
}

/**
 * Link a shared dependency directory into the temp project copy so
 * the renderer can boot without mutating the user's real project.
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
 * @param {string | undefined | null} candidatePath
 * @param {string} allowedRoot
 * @returns {string | null}
 */
function normalizeProjectRelativePath(candidatePath, allowedRoot) {
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
function normalizeChangedFiles(changedFiles, allowedRoot) {
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
 * @param {Record<string, string|null> | undefined} changedFileContents
 * @param {string} allowedRoot
 */
function sanitizeChangedFileContents(changedFileContents, allowedRoot) {
  /** @type {Record<string, string|null>} */
  const files = {};
  /** @type {string[]} */
  const rejected = [];

  for (const [entry, content] of Object.entries(changedFileContents ?? {})) {
    const rel = normalizeProjectRelativePath(entry, allowedRoot);
    if (!rel || (typeof content !== "string" && content !== null)) {
      rejected.push(entry);
      continue;
    }
    files[rel] = content;
  }

  return { files, rejected };
}

/**
 * @param {string | undefined} key
 */
function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 10) return "*".repeat(key.length);
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

/**
 * Compare the edited temp copy with the imported project so the renderer relies
 * on the file delta that actually happened, not just the model-reported list.
 *
 * @param {string} sourceRoot
 * @param {string} editedRoot
 */
async function detectProjectFileChanges(sourceRoot, editedRoot) {
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
 * @param {string[]} paths
 */
function uniquePaths(paths) {
  return [...new Set(paths.filter((value) => typeof value === "string" && value.trim()))];
}
