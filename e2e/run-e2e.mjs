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
const FIXTURE_PROJECT = path.join(ROOT, "e2e/fixtures/sample-app");
const RENDERER_URL = "http://127.0.0.1:5173";

const TIMEOUT_SHORT = 15000;
const TIMEOUT_MEDIUM = 30000;
const TIMEOUT_LONG = 180000;

let devServerProc = null;
let electronApp = null;
let userDataDir = "";
let startedLocalServer = false;

try {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mutatr-e2e-"));

  const serverLogs = [];
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
      serverLogs.push(chunk.toString("utf8"));
    });

    devServerProc.stderr.on("data", (chunk) => {
      serverLogs.push(chunk.toString("utf8"));
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
      MUTATR_MOCK_CLAUDE: "1",
    },
  });

  const page = await electronApp.firstWindow();

  await runFeatureCoverage(page);

  if (
    startedLocalServer &&
    devServerProc &&
    devServerProc.exitCode !== null &&
    devServerProc.exitCode !== 0
  ) {
    throw new Error(`Renderer server exited early. Logs:\n${serverLogs.join("")}`);
  }

  console.log("E2E OK: full feature coverage passed.");
} finally {
  await safeClose(electronApp);
  stopProcess(devServerProc);
  if (userDataDir) {
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

async function runFeatureCoverage(page) {
  let projectId = "";

  await step("boot empty workspace", async () => {
    await expectVisible(page.locator(".projects-overview"), TIMEOUT_SHORT);
    await expectVisible(page.getByRole("button", { name: "Projects" }), TIMEOUT_SHORT);
  });

  await step("add project through API bridge path", async () => {
    const added = await page.evaluate(async (projectPath) => {
      return window.mutatr.addProject(projectPath);
    }, FIXTURE_PROJECT);

    assert.equal(added.ok, true, added.ok ? "" : added.error);
    projectId = added.payload.id;

    await waitForProject(page, projectId, (project) => project?.status === "ready", TIMEOUT_LONG);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectCountAtLeast(page.locator(".project-card"), 1, TIMEOUT_MEDIUM);
  });

  await step("open project and create experiment", async () => {
    await page.locator(".project-card").filter({ hasText: "sample-app" }).first().click();
    await expectVisible(page.getByRole("button", { name: "sample-app", exact: true }), TIMEOUT_SHORT);

    await page.getByRole("button", { name: /New experiment/i }).click();
    await expectVisible(page.getByRole("dialog"), TIMEOUT_SHORT);
    await page.getByPlaceholder("Experiment name").fill("E2E experiment");
    await page.getByRole("button", { name: "Create" }).click();

    await expectVisible(
      page.getByRole("heading", { name: /Choose a page for "E2E experiment"/i }),
      TIMEOUT_SHORT
    );
    await expectCountAtLeast(page.locator(".page-card"), 1, TIMEOUT_MEDIUM);
  });

  await step("select page, set goal, and suggest treatments", async () => {
    await page.locator(".page-card").first().click();
    await expectVisible(page.getByRole("heading", { name: "What's the goal for this page?" }), TIMEOUT_SHORT);

    await page.locator(".goal-textarea").fill("Increase sign-ups");
    await page.getByRole("button", { name: "Continue" }).click();

    await waitForCountOrError(page.locator(".test-item"), page.locator(".error-banner"), 3, TIMEOUT_LONG);

    const implementButton = page.getByRole("button", { name: "Implement selected" });
    assert.equal(
      await implementButton.isDisabled(),
      true,
      "Implement selected should be disabled until at least one treatment is chosen"
    );
  });

  await step("validate treatment selection gating", async () => {
    const testCheckboxes = page.locator(".test-item input[type='checkbox']");
    await expectCountAtLeast(testCheckboxes, 3, TIMEOUT_SHORT);

    const implementButton = page.getByRole("button", { name: "Implement selected" });

    await testCheckboxes.nth(0).check();
    await testCheckboxes.nth(1).check();
    assert.equal(
      await implementButton.isDisabled(),
      false,
      "Implement selected should enable after treatments are checked"
    );

    await setAllChecked(testCheckboxes, false);
    assert.equal(
      await implementButton.isDisabled(),
      true,
      "Implement selected should disable when all treatments are unchecked"
    );

    await testCheckboxes.nth(0).check();
    await testCheckboxes.nth(1).check();
  });

  await step("implement selected treatments and validate render gating", async () => {
    const implementButton = page.getByRole("button", { name: "Implement selected" });
    await implementButton.click();

    await waitForCountOrError(page.locator(".render-card"), page.locator(".error-banner"), 2, TIMEOUT_LONG);

    const renderCheckboxes = page.locator(".render-card input[type='checkbox']");
    await expectCountExactly(renderCheckboxes, 2, TIMEOUT_MEDIUM);

    const continueButton = page.getByRole("button", { name: "Test selected renders" });
    assert.equal(
      await continueButton.isDisabled(),
      false,
      "Render stage should preselect implemented treatments"
    );

    await setAllChecked(renderCheckboxes, false);
    assert.equal(
      await continueButton.isDisabled(),
      true,
      "Test selected renders should disable when all renders are unchecked"
    );

    await renderCheckboxes.first().check();
    assert.equal(
      await continueButton.isDisabled(),
      false,
      "Test selected renders should re-enable after choosing a render"
    );

    await continueButton.click();
  });

  await step("select personas and run attention analysis", async () => {
    await expectVisible(page.getByRole("heading", { name: "Select personas" }), TIMEOUT_SHORT);

    const personaCheckboxes = page.locator(".persona-select-card input[type='checkbox']");
    await expectCountAtLeast(personaCheckboxes, 1, TIMEOUT_SHORT);

    const runTestButton = page.getByRole("button", { name: "Run test" });
    await setAllChecked(personaCheckboxes, false);
    assert.equal(await runTestButton.isDisabled(), true, "Run test should disable without personas");

    await personaCheckboxes.first().check();
    assert.equal(await runTestButton.isDisabled(), false, "Run test should enable after selecting a persona");

    await runTestButton.click();

    await waitForCountOrError(
      page.locator(".comparison-slider-container"),
      page.locator(".error-banner"),
      1,
      TIMEOUT_LONG
    );
    await expectVisible(page.getByRole("heading", { name: "Attention heatmaps" }), TIMEOUT_SHORT);
    await expectVisible(page.getByText("Variant aggregate"), TIMEOUT_SHORT);
    await expectVisible(page.getByText("Issue Detector"), TIMEOUT_SHORT);

    const rationale = (await page.locator(".comparison-rationale p").first().textContent()) ?? "";
    assert.ok(rationale.trim().length > 8, "Heatmap rationale should be non-trivial");
  });

  await step("restore experiment state from project overview", async () => {
    await page.getByRole("button", { name: "sample-app", exact: true }).click();
    await expectVisible(page.locator(".experiment-card").filter({ hasText: "E2E experiment" }), TIMEOUT_SHORT);

    await page.locator(".experiment-card").filter({ hasText: "E2E experiment" }).click();
    await expectVisible(page.getByRole("heading", { name: "Attention heatmaps" }), TIMEOUT_SHORT);
  });

  await step("personas tab: validation, add, refresh", async () => {
    await page.getByRole("button", { name: "sample-app", exact: true }).click();
    await page.getByRole("tab", { name: "Personas" }).click();
    await expectVisible(page.locator(".persona-grid"), TIMEOUT_SHORT);

    await page.getByRole("button", { name: /New persona/i }).click();
    await page.getByRole("button", { name: "Save persona" }).click();
    await expectVisible(page.getByText("Name and summary are required."), TIMEOUT_SHORT);

    await page.getByPlaceholder("Name").fill("E2E Persona");
    await page.getByPlaceholder("Summary").fill("Persona created during full E2E coverage");
    await page.getByPlaceholder("Age band").fill("30-45");
    await page.getByPlaceholder("Motivations (comma sep)").fill("speed, trust");
    await page.getByPlaceholder("Pain points (comma sep)").fill("unclear copy");
    await page.getByPlaceholder("Tone").fill("direct");
    await page.getByPlaceholder("Channels (comma sep)").fill("email");

    await page.getByRole("button", { name: "Save persona" }).click();
    await expectVisible(page.getByText("E2E Persona"), TIMEOUT_SHORT);

    await page.getByRole("button", { name: /Generate with AI/i }).click();
    await waitForProject(page, projectId, (project) => (project?.personas ?? []).length >= 3, TIMEOUT_LONG);
    await expectCountAtLeast(page.locator(".persona-card"), 3, TIMEOUT_MEDIUM);
  });

  await step("settings modal: cancel then save and clear", async () => {
    const openSettings = async () => {
      await page.locator('button[title="Settings"]').click();
      await expectVisible(page.getByRole("dialog"), TIMEOUT_SHORT);
    };

    await openSettings();
    await page.getByPlaceholder("sk-ant-...").fill("test-api-key-cancel");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expectVisible(page.locator('button[title="Settings"]'), TIMEOUT_SHORT);

    await openSettings();
    await page.getByPlaceholder("sk-ant-...").fill("test-api-key-e2e-placeholder");
    await page.locator(".modal select").nth(0).selectOption("opus");
    await page.locator(".modal select").nth(1).selectOption("haiku");
    await page.locator(".modal select").nth(2).selectOption("sonnet");
    await page.locator(".modal select").nth(3).selectOption("haiku");
    await page.getByRole("button", { name: "Save" }).click();

    const savedSettings = await page.evaluate(async () => {
      return window.mutatr.getSettings();
    });
    assert.equal(savedSettings.ok, true, savedSettings.ok ? "" : savedSettings.error);
    assert.equal(savedSettings.payload.hasClaudeApiKey, true, "Claude key should be configured");
    assert.equal(savedSettings.payload.personasModel, "opus");
    assert.equal(savedSettings.payload.suggestionModel, "haiku");
    assert.equal(savedSettings.payload.implementationModel, "sonnet");
    assert.equal(savedSettings.payload.attentionModel, "haiku");
    assert.equal(
      ["encrypted", "session"].includes(savedSettings.payload.apiKeyStorage),
      true,
      `Unexpected storage mode: ${savedSettings.payload.apiKeyStorage}`
    );

    await openSettings();
    await page.getByPlaceholder("sk-ant-...").fill("");
    await page.getByRole("button", { name: "Save" }).click();

    const clearedSettings = await page.evaluate(async () => {
      return window.mutatr.getSettings();
    });
    assert.equal(clearedSettings.ok, true, clearedSettings.ok ? "" : clearedSettings.error);
    assert.equal(clearedSettings.payload.hasClaudeApiKey, false, "Claude key should be cleared");
    assert.equal(clearedSettings.payload.apiKeyStorage, "none");
  });

  await step("navigate back to projects and remove project", async () => {
    await page.getByRole("button", { name: "Projects" }).click();
    await expectVisible(page.locator(".projects-overview"), TIMEOUT_SHORT);

    await page.locator(".project-card-remove").first().click();
    await waitForProjectCount(page, 0, TIMEOUT_MEDIUM);
    await expectCountExactly(page.locator(".project-card"), 0, TIMEOUT_SHORT);

    const listResult = await page.evaluate(async () => {
      return window.mutatr.listProjects();
    });
    assert.equal(listResult.ok, true, listResult.ok ? "" : listResult.error);
    assert.equal(listResult.payload.length, 0, "Project list should be empty after deletion");
  });
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

async function expectCountExactly(locator, exactCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = await locator.count();
    if (count === exactCount) {
      return;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for exactly ${exactCount} elements.`);
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

async function waitForProjectCount(page, exactCount, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await page.evaluate(async () => {
      return window.mutatr.listProjects();
    });
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (result.payload.length === exactCount) {
      return;
    }
    await wait(250);
  }

  throw new Error(`Timed out waiting for ${exactCount} projects.`);
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
    await wait(350);
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
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
