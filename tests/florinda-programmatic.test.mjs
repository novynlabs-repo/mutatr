import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEFAULT_MODELS } from "../electron/services/modelPreferences.mjs";
import { renderVariant } from "../electron/services/playwrightService.mjs";
import { implementVariantInTempProject } from "../electron/services/variantImplementation.mjs";

const PROJECT_ROOT =
  process.env.MUTATR_LIVE_PROJECT_ROOT || "/Users/ahmedashraf/Documents/untitled folder/Florinda/Landing";
const API_KEY = process.env.E2E_CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const FINDER_STYLE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const ROUTE_CASES = [
  {
    route: "/",
    pageFile: "app/page.tsx",
    tests: [
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
    ],
  },
  {
    route: "/privacy",
    pageFile: "app/privacy/page.tsx",
    tests: [
      {
        title: "Surface social proof earlier",
        implementationPrompt:
          "Add lightweight social proof (customer logos or testimonial snippet) above the fold without breaking layout.",
      },
    ],
  },
];
test(
  "Florinda canonical treatments implement and render under a Finder-like PATH",
  { timeout: 35 * 60_000 },
  async (t) => {
    if (!API_KEY) {
      t.skip("Set E2E_CLAUDE_API_KEY or ANTHROPIC_API_KEY to run the live Florinda integration test.");
      return;
    }

    for (const routeCase of ROUTE_CASES) {
      for (const suggestedTest of routeCase.tests) {
        await t.test(`${routeCase.route} :: ${suggestedTest.title}`, async () => {
          const imageDir = path.join(os.tmpdir(), `mutatr-florinda-img-${crypto.randomUUID().slice(0, 8)}`);
          const originalPath = process.env.PATH;
          let result = null;

          try {
            process.env.PATH = FINDER_STYLE_PATH;
            await fs.mkdir(imageDir, { recursive: true });

            result = await implementVariantInTempProject({
              projectRoot: PROJECT_ROOT,
              page: {
                route: routeCase.route,
                filePath: path.join(PROJECT_ROOT, routeCase.pageFile),
              },
              test: suggestedTest,
              apiKey: API_KEY,
              model: DEFAULT_MODELS.implementationModel,
            });
            assert.equal(
              result.impl.changedFiles.length > 0,
              true,
              `No project edits detected for ${routeCase.route} :: ${suggestedTest.title}`
            );

            const render = await renderVariant({
              projectRoot: result.tempRoot,
              route: routeCase.route,
              imageDir,
              label: `${routeCase.route} - ${suggestedTest.title}`,
            });

            assert.ok(render.screenshotPath, `Render produced no screenshot path for ${routeCase.route}`);
            assert.equal(
              (render.attentionAnchors ?? []).length >= 4,
              true,
              `Render looks like fallback output for ${routeCase.route} :: ${suggestedTest.title}`
            );
          } finally {
            process.env.PATH = originalPath;
            if (result?.tempRoot) {
              await fs.rm(result.tempRoot, { recursive: true, force: true });
            }
            await fs.rm(imageDir, { recursive: true, force: true });
          }
        });
      }
    }
  }
);
