import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { _electron as electron } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const FIXTURE_PROJECT = path.join(ROOT, "e2e/fixtures/live-app");
const RENDERER_URL = "http://127.0.0.1:5173";

const API_KEY = process.env.E2E_CLAUDE_API_KEY ?? "";
if (!API_KEY) {
  throw new Error("Missing E2E_CLAUDE_API_KEY environment variable.");
}

const EXPECTED_ROUTE_COLORS = {
  "/": [208, 74, 74],
  "/login": [55, 111, 202],
  "/pricing": [46, 152, 99],
  "/dashboard": [170, 122, 47],
};

const TIMEOUT_SHORT = 20000;
const TIMEOUT_MEDIUM = 60000;
const TIMEOUT_LONG = 600000;

let devServerProc = null;
let electronApp = null;
let userDataDir = "";
let startedLocalServer = false;

try {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mutatr-live-e2e-"));

  const rendererLogs = [];
  if (!(await isServerUp(RENDERER_URL))) {
    startedLocalServer = true;
    devServerProc = spawn("npm", ["run", "dev:renderer"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
    });

    devServerProc.stdout.on("data", (chunk) => {
      rendererLogs.push(chunk.toString("utf8"));
    });
    devServerProc.stderr.on("data", (chunk) => {
      rendererLogs.push(chunk.toString("utf8"));
    });

    await waitForServer(RENDERER_URL, TIMEOUT_MEDIUM);
  }

  electronApp = await electron.launch({
    cwd: ROOT,
    args: ["electron/main.mjs"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      MUTATR_DISABLE_DEVTOOLS: "1",
      MUTATR_USER_DATA_DIR: userDataDir,
    },
  });

  const page = await electronApp.firstWindow();

  let projectId = "";
  let pageRecords = [];

  await step("boot", async () => {
    await expectVisible(page.locator(".projects-overview"), TIMEOUT_SHORT);
    await expectVisible(page.getByRole("button", { name: "Projects" }), TIMEOUT_SHORT);
  });

  await step("configure real Claude key", async () => {
    const keyResult = await page.evaluate(async (apiKey) => {
      return window.mutatr.updateSettings({ claudeApiKey: apiKey });
    }, API_KEY);

    assert.equal(keyResult.ok, true, keyResult.ok ? "" : keyResult.error);
    assert.equal(keyResult.payload.hasClaudeApiKey, true, "Claude key should be configured");
  });

  await step("add live fixture project", async () => {
    const addResult = await page.evaluate(async (projectPath) => {
      return window.mutatr.addProject(projectPath);
    }, FIXTURE_PROJECT);

    assert.equal(addResult.ok, true, addResult.ok ? "" : addResult.error);
    assert.equal(addResult.payload.name, "live-e2e-app");
    projectId = addResult.payload.id;

    const project = await waitForProject(page, projectId, (entry) => entry?.status === "ready", TIMEOUT_LONG);
    pageRecords = project?.pages ?? [];
    await page.reload({ waitUntil: "domcontentloaded" });
  });

  await step("verify page-wise rendering is real (not fallback)", async () => {
    assert.equal(pageRecords.length >= 4, true, "Expected at least four discovered pages");

    for (const pageRecord of pageRecords) {
      const expectedColor = EXPECTED_ROUTE_COLORS[pageRecord.route];
      if (!expectedColor) continue;
      assert.ok(pageRecord.thumbnailDataUrl, `Missing thumbnail for route ${pageRecord.route}`);

      const center = await extractBackgroundPixelInBrowser(page, pageRecord.thumbnailDataUrl);
      assertColorNear(
        center,
        expectedColor,
        48,
        `Route ${pageRecord.route} thumbnail appears to be fallback/non-live render`
      );
    }
  });

  await step("open project UI and create experiment", async () => {
    await page.locator(".project-card").filter({ hasText: "live-e2e-app" }).first().click();
    await expectVisible(page.getByRole("button", { name: "live-e2e-app", exact: true }), TIMEOUT_SHORT);

    await page.getByRole("button", { name: /New experiment/i }).click();
    await expectVisible(page.getByRole("dialog"), TIMEOUT_SHORT);
    await page.getByPlaceholder("Experiment name").fill("Live E2E experiment");
    await page.getByRole("button", { name: "Create" }).click();

    await expectVisible(
      page.getByRole("heading", { name: /Choose a page for "Live E2E experiment"/i }),
      TIMEOUT_SHORT
    );
  });

  await step("suggest tests via real Claude", async () => {
    await page.locator(".page-card").first().click();
    await expectVisible(page.getByRole("heading", { name: "What's the goal for this page?" }), TIMEOUT_SHORT);

    await page.locator(".goal-textarea").fill("Increase sign-ups");
    await page.getByRole("button", { name: "Continue" }).click();

    await waitForCountOrError(page.locator(".test-item"), page.locator(".error-banner"), 1, TIMEOUT_LONG);

    const testCount = await page.locator(".test-item").count();
    assert.equal(testCount >= 1, true, "No tests were suggested");

    const testsText = await page.locator(".test-title").allTextContents();
    const fallbackTitles = new Set([
      "Strengthen hero CTA copy",
      "Surface social proof earlier",
      "Reduce form friction",
    ]);
    const allFallback = testsText.every((title) => fallbackTitles.has(title.trim()));
    assert.equal(allFallback, false, "Suggest tests appears to be fallback, not real Claude output");
  });

  await step("implement one test via real Claude and render variant", async () => {
    const testCheckboxes = page.locator(".test-item input[type='checkbox']");
    await expectCountAtLeast(testCheckboxes, 1, TIMEOUT_SHORT);
    await setAllChecked(testCheckboxes, false);
    await testCheckboxes.first().check();

    await page.getByRole("button", { name: "Implement selected" }).click();
    await waitForCountOrError(page.locator(".render-card"), page.locator(".error-banner"), 1, TIMEOUT_LONG);

    const failedRenderCount = await page.locator(".render-card span", { hasText: "(failed)" }).count();
    assert.equal(failedRenderCount, 0, "Render includes failed Claude implementation");
  });

  await step("run attention via real Claude", async () => {
    await page.getByRole("button", { name: "Test selected renders" }).click();

    const personaCheckboxes = page.locator(".persona-select-card input[type='checkbox']");
    await expectCountAtLeast(personaCheckboxes, 1, TIMEOUT_SHORT);
    await setAllChecked(personaCheckboxes, false);
    await personaCheckboxes.first().check();

    await page.getByRole("button", { name: "Run test" }).click();
    await waitForCountOrError(
      page.locator(".comparison-slider-container"),
      page.locator(".error-banner"),
      1,
      TIMEOUT_LONG
    );

    const rationale = (await page.locator(".comparison-rationale p").first().textContent()) ?? "";
    assert.equal(
      rationale.includes("Claude image analysis was unavailable"),
      false,
      "Attention result appears to be heuristic fallback, not real Claude output"
    );
  });

  await step("verify personas are not default fallback trio", async () => {
    const listResult = await page.evaluate(async () => window.mutatr.listProjects());
    assert.equal(listResult.ok, true, listResult.ok ? "" : listResult.error);
    const project = listResult.payload.find((entry) => entry.id === projectId);
    assert.ok(project, "Project missing in state");

    const names = (project?.personas ?? []).map((persona) => persona.name).sort();
    const defaultNames = ["Aldric the Elder", "Finnegan the Young", "Nadia the Ops Lead"].sort();
    assert.notDeepEqual(names, defaultNames, "Personas appear to be fallback set, not real Claude output");
  });

  if (startedLocalServer && devServerProc && devServerProc.exitCode && devServerProc.exitCode !== 0) {
    throw new Error(`Renderer server exited early:\n${rendererLogs.join("")}`);
  }

  console.log("LIVE E2E OK: real Claude + real page rendering verified.");
} finally {
  await safeClose(electronApp);
  stopProcess(devServerProc);
  if (userDataDir) {
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

async function extractBackgroundPixelInBrowser(page, dataUrl) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load thumbnail image"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create 2D canvas context");
    ctx.drawImage(img, 0, 0);

    const x = Math.max(0, Math.floor(img.width * 0.05));
    const y = Math.max(0, Math.floor(img.height * 0.05));
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  }, dataUrl);
}

function assertColorNear(actualRgb, expectedRgb, tolerance, message) {
  const distance =
    Math.abs(actualRgb[0] - expectedRgb[0]) +
    Math.abs(actualRgb[1] - expectedRgb[1]) +
    Math.abs(actualRgb[2] - expectedRgb[2]);
  assert.equal(
    distance <= tolerance,
    true,
    `${message}. actual=${actualRgb.join(",")} expected=${expectedRgb.join(",")} dist=${distance}`
  );
}

async function expectVisible(locator, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
}

async function expectCountAtLeast(locator, minCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await locator.count();
    if (count >= minCount) {
      return count;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for at least ${minCount} elements.`);
}

async function waitForCountOrError(targetLocator, errorLocator, minCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const targetCount = await targetLocator.count();
    if (targetCount >= minCount) {
      return targetCount;
    }

    if (await errorLocator.count()) {
      const errorText = (await errorLocator.first().textContent()) ?? "Unknown UI error";
      throw new Error(errorText.trim());
    }

    await wait(250);
  }
  throw new Error(`Timed out waiting for at least ${minCount} matching elements.`);
}

async function setAllChecked(locator, checked) {
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    if (checked) {
      await locator.nth(i).check();
    } else {
      await locator.nth(i).uncheck();
    }
  }
}

async function waitForProject(page, projectId, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await page.evaluate(async () => {
      return window.mutatr.listProjects();
    });
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    const project = result.payload.find((entry) => entry.id === projectId);
    if (predicate(project ?? null)) {
      return project ?? null;
    }
    await wait(350);
  }

  throw new Error(`Timed out waiting for project ${projectId} to reach the expected state.`);
}

async function step(name, fn) {
  process.stdout.write(`STEP: ${name}\n`);
  await fn();
}

async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isServerUp(url)) {
      return;
    }
    await wait(300);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function isServerUp(url) {
  try {
    const response = await fetch(url);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function safeClose(appInstance) {
  if (!appInstance) return;
  try {
    await appInstance.close();
  } catch {
    // ignore cleanup failures
  }
}

function stopProcess(proc) {
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
