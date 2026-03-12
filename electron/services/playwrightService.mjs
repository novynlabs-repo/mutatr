import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { guessDevCommands } from "./projectService.mjs";

const DEV_PORT = 4179;
const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
const DEV_START_TIMEOUT_MS = 60000;
const RECOVERABLE_RENDER_PASSES = 3;

/**
 * @param {{
 * projectRoot: string;
 * pages: import('./types.mjs').PageRecord[];
 * personas: import('./types.mjs').PersonaRecord[];
 * imageDir: string;
 * }} input
 */
export async function renderPageThumbnails(input) {
  if (!input.pages.length) return [];

  await fs.mkdir(input.imageDir, { recursive: true });

  const captured = [];

  await withProjectBrowser(input.projectRoot, async (browser, baseUrl, startupIssue) => {
    for (let i = 0; i < input.pages.length; i += 1) {
      const page = input.pages[i];
      const capture = await renderSinglePage(browser, {
        baseUrl,
        route: page.route,
        imageDir: input.imageDir,
        label: page.route,
        startupIssue,
      });

      captured.push({
        ...page,
        thumbnailDataUrl: capture.screenshotDataUrl,
        screenshotPath: capture.screenshotPath,
        mobileScreenshotDataUrl: capture.mobileScreenshotDataUrl,
        mobileScreenshotPath: capture.mobileScreenshotPath,
        attentionAnchors: capture.attentionAnchors,
        mobileAttentionAnchors: capture.mobileAttentionAnchors,
        personaSnapshot: undefined,
      });
    }
  });

  return captured;
}

/**
 * @param {{
 * projectRoot: string;
 * route: string;
 * imageDir: string;
 * persona?: import('./types.mjs').PersonaRecord;
 * label?: string;
 * }} input
 */
export async function renderVariant(input) {
  let capture = null;
  await withProjectBrowser(input.projectRoot, async (browser, baseUrl, startupIssue) => {
    capture = await renderSinglePage(browser, {
      baseUrl,
      route: input.route,
      imageDir: input.imageDir,
      label: input.label ?? input.route,
      persona: input.persona,
      startupIssue,
    });
  });
  return capture;
}

/**
 * Renders a Clarity/Hotjar-style heatmap: full blue wash over the page
 * with hotspots transitioning blue → green → yellow → red.
 * Uses a canvas intensity map + colormap for smooth gradients.
 *
 * @param {{
 * baseImageDataUrl: string;
 * boxes: {x:number; y:number; width:number; height:number; weight:number;}[];
 * imageDir: string;
 * }} input
 */
export async function renderHeatmapOverlay(input) {
  await fs.mkdir(input.imageDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 4000 } });

    const boxesJson = JSON.stringify(input.boxes);

    await page.setContent(`
      <html>
        <head>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; background: #0b0b11; display: flex; justify-content: center; width: 100vw; min-height: 100vh; padding: 0; }
            .frame { position: relative; display: inline-block; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.55); }
            .frame img { display: block; width: 100%; }
            .frame canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
          </style>
        </head>
        <body>
          <div class="frame">
            <img id="base" src="${input.baseImageDataUrl}" />
            <canvas id="heatmap"></canvas>
          </div>
          <script>
            const img = document.getElementById('base');
            const canvas = document.getElementById('heatmap');

            function render() {
              const W = img.naturalWidth || img.offsetWidth;
              const H = img.naturalHeight || img.offsetHeight;
              canvas.width = W;
              canvas.height = H;

              const boxes = ${boxesJson};
              const ctx = canvas.getContext('2d');

              // Step 1: Build grayscale intensity map
              const intensity = document.createElement('canvas');
              intensity.width = W;
              intensity.height = H;
              const ictx = intensity.getContext('2d');

              // Black background = zero intensity everywhere
              ictx.fillStyle = '#000';
              ictx.fillRect(0, 0, W, H);

              // Additive blending: overlapping hotspots accumulate
              ictx.globalCompositeOperation = 'lighter';

              for (const box of boxes) {
                const cx = (box.x + box.width / 2) * W;
                const cy = (box.y + box.height / 2) * H;
                const rx = (box.width / 2) * W;
                const ry = (box.height / 2) * H;
                const r = Math.max(rx, ry) * 1.6;

                const grad = ictx.createRadialGradient(cx, cy, 0, cx, cy, r);
                const peak = Math.min(1, box.weight);
                grad.addColorStop(0, 'rgba(255,255,255,' + peak + ')');
                grad.addColorStop(0.4, 'rgba(255,255,255,' + (peak * 0.5) + ')');
                grad.addColorStop(1, 'rgba(255,255,255,0)');

                ictx.save();
                ictx.translate(cx, cy);
                ictx.scale(1, ry / rx || 1);
                ictx.translate(-cx, -cy);
                ictx.fillStyle = grad;
                ictx.beginPath();
                ictx.arc(cx, cy, r, 0, Math.PI * 2);
                ictx.fill();
                ictx.restore();
              }

              // Step 2: Read intensity and apply colormap
              const idata = ictx.getImageData(0, 0, W, H);
              const out = ctx.createImageData(W, H);

              for (let i = 0; i < idata.data.length; i += 4) {
                // Intensity is the red channel (all channels are equal from grayscale)
                const raw = idata.data[i] / 255;
                const t = Math.min(1, raw);

                // Colormap: blue → cyan → green → yellow → red
                let r, g, b;
                if (t < 0.25) {
                  const s = t / 0.25;
                  r = 0; g = Math.round(s * 255); b = 255;
                } else if (t < 0.5) {
                  const s = (t - 0.25) / 0.25;
                  r = 0; g = 255; b = Math.round(255 * (1 - s));
                } else if (t < 0.75) {
                  const s = (t - 0.5) / 0.25;
                  r = Math.round(255 * s); g = 255; b = 0;
                } else {
                  const s = (t - 0.75) / 0.25;
                  r = 255; g = Math.round(255 * (1 - s)); b = 0;
                }

                out.data[i]     = r;
                out.data[i + 1] = g;
                out.data[i + 2] = b;
                // Semi-transparent overlay: light blue tint on cold areas, stronger on hot
                out.data[i + 3] = Math.round(50 + t * 100);
              }

              ctx.putImageData(out, 0, 0);
            }

            if (img.complete) { render(); }
            else { img.onload = render; }
          <\/script>
        </body>
      </html>
    `);

    // Wait for the image to load and the canvas to render
    await page.waitForTimeout(600);

    const outFile = path.join(input.imageDir, `heatmap-${Date.now()}-${hash(Math.random().toString())}.png`);
    const frame = await page.locator(".frame").boundingBox();

    if (!frame) {
      throw new Error("Unable to render heatmap frame.");
    }

    await page.screenshot({
      path: outFile,
      fullPage: true,
      clip: {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      },
    });

    return await fileToDataUrl(outFile);
  } finally {
    await browser.close();
  }
}

/**
 * @param {string} projectRoot
 * @param {(browser: import('playwright').Browser, baseUrl: string|null, startupIssue: string|null) => Promise<void>} fn
 */
async function withProjectBrowser(projectRoot, fn) {
  const browser = await chromium.launch({ headless: true });
  const devServer = await startDevServer(projectRoot);

  try {
    await fn(browser, devServer.baseUrl, devServer.issue ?? null);
  } finally {
    await browser.close();
    if (devServer.proc) {
      stopProcess(devServer.proc);
    }
  }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {{
 * baseUrl: string | null;
 * route: string;
 * imageDir: string;
 * label: string;
 * persona?: import('./types.mjs').PersonaRecord;
 * startupIssue?: string | null;
 * }} input
 */
async function renderSinglePage(browser, input) {
  const desktopFile = path.join(input.imageDir, `page-${Date.now()}-${hash(`${input.label}-desktop`)}.png`);
  const mobileFile = path.join(input.imageDir, `page-${Date.now()}-${hash(`${input.label}-mobile`)}.png`);

  const page = await browser.newPage();
  /** @type {import('./types.mjs').AttentionAnchor[]} */
  let attentionAnchors = [];
  /** @type {import('./types.mjs').AttentionAnchor[]} */
  let mobileAttentionAnchors = [];

  try {
    await prepareRenderedPage(page, input);
    const desktopCapture = await captureView(page, {
      filePath: desktopFile,
      viewport: { width: 1280, height: 720 },
      isMobile: false,
    });
    attentionAnchors = desktopCapture.attentionAnchors;

    const mobileCapture = await captureView(page, {
      filePath: mobileFile,
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    mobileAttentionAnchors = mobileCapture.attentionAnchors;
  } catch {
    // Fallback render for failed navigation.
    await page.goto("about:blank").catch(() => {});
    await page.setContent(`
      <html><body style="margin:0;background:#0f1118;color:#e8e8ec;display:grid;place-items:center;height:100vh;font-family:ui-sans-serif,system-ui;">
        <div style="padding:24px;border:1px solid rgba(255,255,255,.15);border-radius:16px;background:rgba(255,255,255,.04)">
          <strong>Render failed</strong><br />
          ${escapeHtml(input.label)}
        </div>
      </body></html>
    `, { waitUntil: "domcontentloaded", timeout: 5000 });
    const desktopCapture = await captureView(page, {
      filePath: desktopFile,
      viewport: { width: 1280, height: 720 },
      isMobile: false,
    });
    attentionAnchors = desktopCapture.attentionAnchors;

    const mobileCapture = await captureView(page, {
      filePath: mobileFile,
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    mobileAttentionAnchors = mobileCapture.attentionAnchors;
  } finally {
    await page.close();
  }

  return {
    screenshotDataUrl: await fileToDataUrl(desktopFile),
    screenshotPath: desktopFile,
    mobileScreenshotDataUrl: await fileToDataUrl(mobileFile),
    mobileScreenshotPath: mobileFile,
    attentionAnchors,
    mobileAttentionAnchors,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {{
 * baseUrl: string | null;
 * route: string;
 * label: string;
 * persona?: import('./types.mjs').PersonaRecord;
 * startupIssue?: string | null;
 * }} input
 */
async function prepareRenderedPage(page, input) {
  if (input.baseUrl) {
    const personaParams = input.persona
      ? `mutatr_persona=${encodeURIComponent(input.persona.name)}&mutatr_tone=${encodeURIComponent(
          input.persona.tone
        )}`
      : "";

    const route = input.route.startsWith("/") ? input.route : `/${input.route}`;
    const url = `${input.baseUrl}${route}${personaParams ? `?${personaParams}` : ""}`;

    await page.addInitScript((persona) => {
      if (persona) {
        window.__MUTATR_PERSONA__ = persona;
      }
    }, input.persona ?? null);

    for (let attempt = 0; attempt < RECOVERABLE_RENDER_PASSES; attempt += 1) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800 + attempt * 500);

      const recoverableIssue = await detectRecoverableRenderIssue(page);
      if (!recoverableIssue) {
        return;
      }

      if (attempt === RECOVERABLE_RENDER_PASSES - 1) {
        throw new Error(recoverableIssue);
      }
    }
  }

  await page.setContent(`
    <html>
      <head>
        <style>
          body {
            margin: 0;
            width: 100vw;
            height: 100vh;
            display: grid;
            place-items: center;
            background: radial-gradient(circle at 20% 20%, #222534, #0d0f17);
            color: #f1f1f4;
            font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .card {
            width: min(980px, 92vw);
            min-height: 460px;
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,0.16);
            background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
            padding: 26px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          }
          .eyebrow { color: #9ca3b6; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; }
          h1 { margin-top: 14px; font-size: 44px; line-height: 1.05; }
          p { color: #c6cad7; max-width: 66ch; }
          .chips { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
          .chip { border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; padding: 8px 12px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="eyebrow">render fallback</div>
          <h1>${escapeHtml(input.label)}</h1>
          <p>Unable to spin up a local dev server for this project automatically. This placeholder tile is still selectable in the experimentation flow.</p>
          <div class="chips">
            ${input.persona ? `<span class=\"chip\">Persona: ${escapeHtml(input.persona.name)}</span>` : ""}
            <span class="chip">Route: ${escapeHtml(input.route)}</span>
          </div>
          ${
            input.startupIssue
              ? `<p style="margin-top:14px;color:#f3b7b7;font-size:12px;line-height:1.4;">${escapeHtml(input.startupIssue)}</p>`
              : ""
          }
        </div>
      </body>
    </html>
  `);
}

/**
 * @param {import('playwright').Page} page
 * @param {{
 * filePath: string;
 * viewport: { width: number; height: number };
 * isMobile: boolean;
 * }} input
 */
async function captureView(page, input) {
  await page.setViewportSize(input.viewport);
  await page.emulateMedia({ media: "screen" });
  await waitForRenderableContent(page, input.isMobile ? 7000 : 5000);

  /** @type {import('./types.mjs').AttentionAnchor[]} */
  let attentionAnchors = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout((input.isMobile ? 250 : 180) + attempt * 220);
    attentionAnchors = await extractAttentionAnchors(page);
    if (attentionAnchors.length > 0) {
      break;
    }
  }

  await page.screenshot({ path: input.filePath, fullPage: true });
  return { attentionAnchors };
}

/**
 * @param {string} projectRoot
 * @param {string} command
 */
async function tryDevCommand(projectRoot, command) {
  const env = buildProjectCommandEnv(projectRoot);
  const shell = resolveCommandShell();
  const shellArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", command]
      : ["-lc", command];
  const proc = spawn(shell, shellArgs, {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const log = createLineCollector();
  proc.stdout?.on("data", (chunk) => log.push(chunk));
  proc.stderr?.on("data", (chunk) => log.push(chunk));
  const waitResult = await waitForServer(DEV_URL, DEV_START_TIMEOUT_MS, proc);

  if (waitResult.ok) {
    return { ok: true, proc, failureDetail: "" };
  }

  const detail = `${command}\nreason: ${waitResult.reason}\n${log
    .last(6)
    .map((line) => `  ${line}`)
    .join("\n")}`;
  stopProcess(proc);
  return { ok: false, proc: null, failureDetail: detail };
}

/**
 * @param {string} projectRoot
 */
async function startDevServer(projectRoot) {
  const commands = await guessDevCommands(projectRoot);
  if (!commands.length) {
    return {
      proc: null,
      baseUrl: null,
      issue: "No runnable dev/start script found in package.json.",
    };
  }

  /** @type {string[]} */
  const failures = [];

  for (const command of commands) {
    const attempt = await tryDevCommand(projectRoot, command);
    if (attempt.ok) {
      return { proc: attempt.proc, baseUrl: DEV_URL, issue: null };
    }
    failures.push(attempt.failureDetail);
  }

  const dependencyGuidance = failures.some((detail) =>
    /node_modules|Cannot find|MODULE_NOT_FOUND|find_package|pnpm install|npm install|yarn install/i.test(detail)
  )
    ? "\n\nDependencies appear to be missing. Install them in this project yourself before rendering."
    : "";

  return {
    proc: null,
    baseUrl: null,
    issue: `Dev server failed to start on ${DEV_URL}.\n${failures
      .slice(0, 2)
      .join("\n\n")
      .slice(0, 1200)}${dependencyGuidance}`,
  };
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {import('node:child_process').ChildProcess} proc
 */
async function waitForServer(url, timeoutMs, proc) {
  let exitCode = null;
  let exitSignal = null;
  const onExit = (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  };
  proc.once("exit", onExit);

  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      if (exitCode !== null || exitSignal !== null) {
        return {
          ok: false,
          reason: `process exited before server became reachable (code=${String(exitCode)} signal=${String(
            exitSignal
          )})`,
        };
      }

      try {
        const res = await fetch(url, { method: "GET" });
        if (res.status > 0) {
          return { ok: true, reason: "" };
        }
      } catch {
        // keep polling
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return { ok: false, reason: `timed out after ${timeoutMs}ms` };
  } finally {
    proc.off("exit", onExit);
  }
}

/**
 * @param {string} filePath
 */
async function fileToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  const raw = await fs.readFile(filePath);
  return `data:${mime};base64,${raw.toString("base64")}`;
}

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createLineCollector() {
  /** @type {string[]} */
  const lines = [];
  return {
    /**
     * @param {Buffer|string} chunk
     */
    push(chunk) {
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push(trimmed);
      }
      if (lines.length > 80) {
        lines.splice(0, lines.length - 80);
      }
    },
    /**
     * @param {number} count
     */
    last(count) {
      return lines.slice(-count);
    },
  };
}

/**
 * Retry when Next dev serves its transient runtime overlay instead of the page.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string | null>}
 */
async function detectRecoverableRenderIssue(page) {
  try {
    return await page.evaluate(() => {
      const text = String(document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
      const nextPortalText = String(document.querySelector("nextjs-portal")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
      const source = `${text}\n${nextPortalText}`;
      const hasNextOverlay = Boolean(document.querySelector("nextjs-portal"));
      const looksLikeRuntimeOverlay =
        (/Runtime (?:Error|SyntaxError|TypeError|ReferenceError)/i.test(source)
          && (/Call Stack/i.test(source) || /Was this helpful\\?/i.test(source)))
        || (/Unexpected end of JSON input/i.test(source) && /Call Stack/i.test(source))
        || (hasNextOverlay && /Next\\.js/i.test(source) && /Call Stack/i.test(source));

      return looksLikeRuntimeOverlay
        ? `Route rendered with a transient Next.js runtime overlay: ${source.slice(0, 240)}`
        : null;
    });
  } catch {
    return null;
  }
}

/**
 * Finder-launched macOS apps often inherit a minimal PATH that omits Homebrew,
 * Volta, and local package-manager shims. Add the common toolchain locations so
 * `npm run dev` works the same way it does in a terminal.
 *
 * @param {string} projectRoot
 */
function buildProjectCommandEnv(projectRoot) {
  const homeDir = os.homedir();
  const pathEntries = [
    path.join(projectRoot, "node_modules", ".bin"),
    ...(process.env.PATH ? process.env.PATH.split(path.delimiter) : []),
    path.join(homeDir, ".volta", "bin"),
    path.join(homeDir, ".asdf", "shims"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].filter(Boolean);

  return {
    ...process.env,
    PORT: String(DEV_PORT),
    BROWSER: "none",
    PATH: [...new Set(pathEntries)].join(path.delimiter),
  };
}

function resolveCommandShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

/**
 * @param {import('node:child_process').ChildProcess} proc
 */
function stopProcess(proc) {
  if (!proc?.pid) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-proc.pid, "SIGTERM");
      return;
    }
  } catch {
    // Fall back to per-process termination below.
  }

  try {
    proc.kill("SIGTERM");
  } catch {
    // Process is already gone.
  }
}

/**
 * Wait until the page contains enough visible content that a screenshot/anchor
 * capture is likely to represent the actual route instead of a compile blank or
 * mid-transition shell.
 *
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 */
async function waitForRenderableContent(page, timeoutMs) {
  try {
    await page.waitForFunction(
      (selector) => {
        const elements = [...document.querySelectorAll(selector)];
        const visibleCount = elements.filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          if (!rect.width || !rect.height) return false;
          if (style.display === "none" || style.visibility === "hidden") return false;
          return Number(style.opacity || "1") >= 0.05;
        }).length;
        const text = String(document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
        return visibleCount >= 3 || text.length >= 120;
      },
      "h1, h2, h3, button, a[href], [role='button'], form, input:not([type='hidden']), textarea, select, img, svg, video, picture, [role='img'], p, li, blockquote",
      { timeout: timeoutMs }
    );
  } catch {
    // Fall back to the retry loop in captureView if the page stays sparse.
  }
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<import('./types.mjs').AttentionAnchor[]>}
 */
async function extractAttentionAnchors(page) {
  /** @type {Omit<import('./types.mjs').AttentionAnchor, 'id'>[]} */
  const rawAnchors = await page.evaluate(() => {
    const CTA_RE = /\b(start|get|try|book|buy|subscribe|contact|schedule|join|learn more|request|download|sign up|continue|apply|create|launch)\b/i;
    const PROOF_RE = /\b(testimonial|review|rating|customer|trusted|trust|case study|logos?|as seen in|guarantee|secure|compliance|proof)\b/i;

    const selectors = [
      "h1, h2, h3",
      "button, a[href], [role='button'], input[type='submit'], input[type='button']",
      "form, input:not([type='hidden']), textarea, select",
      "img, svg, video, picture, [role='img']",
      "p, li, blockquote",
    ].join(", ");

    const pageWidth = Math.max(
      document.documentElement?.scrollWidth ?? 0,
      document.body?.scrollWidth ?? 0,
      window.innerWidth
    );
    const pageHeight = Math.max(
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0,
      window.innerHeight
    );

    const normalizeText = (value, maxLen = 120) =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);

    const classify = (el, role, label) => {
      const tagName = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tagName) || role === "heading") return "headline";
      if (
        tagName === "form" ||
        tagName === "textarea" ||
        tagName === "select" ||
        tagName === "input" ||
        role === "textbox" ||
        role === "searchbox"
      ) {
        return "form";
      }
      if (tagName === "img" || tagName === "svg" || tagName === "video" || tagName === "picture" || role === "img") {
        return "media";
      }
      if (tagName === "blockquote" || PROOF_RE.test(label)) return "proof";
      if (tagName === "button" || tagName === "a" || role === "button" || role === "link") {
        return CTA_RE.test(label) ? "cta" : "interactive";
      }
      return "copy";
    };

    const basePriority = (kind) => {
      switch (kind) {
        case "cta":
          return 100;
        case "form":
          return 95;
        case "headline":
          return 90;
        case "proof":
          return 78;
        case "media":
          return 72;
        case "interactive":
          return 68;
        default:
          return 56;
      }
    };

    const candidates = [];
    for (const el of document.querySelectorAll(selectors)) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (!rect.width || !rect.height) continue;
      if (rect.width < 24 || rect.height < 12) continue;
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") < 0.05) continue;
      if (rect.bottom < -12 || rect.right < -12) continue;

      const role = normalizeText(el.getAttribute("role") || "");
      const label = normalizeText(
        el.getAttribute("aria-label") ||
          el.getAttribute("alt") ||
          el.getAttribute("title") ||
          el.getAttribute("placeholder") ||
          el.textContent ||
          (el instanceof HTMLInputElement ? el.value : ""),
      );
      const tagName = el.tagName.toLowerCase();
      const kind = classify(el, role, label);

      if (!label && kind !== "media" && kind !== "form") continue;
      if (kind === "copy" && label.length < 28) continue;

      const x = Math.max(0, (rect.left + window.scrollX) / pageWidth);
      const y = Math.max(0, (rect.top + window.scrollY) / pageHeight);
      const width = Math.min(1, rect.width / pageWidth);
      const height = Math.min(1, rect.height / pageHeight);
      if (width < 0.02 || height < 0.015) continue;

      const aboveFoldBonus = y < 0.35 ? 12 : y < 0.65 ? 6 : 0;
      const sizeBonus = Math.min(12, (rect.width * rect.height) / 18000);
      const keywordBonus = kind === "cta" || kind === "proof" ? 6 : 0;

      candidates.push({
        kind,
        label,
        tagName,
        role,
        x,
        y,
        width,
        height,
        priority: Math.round(basePriority(kind) + aboveFoldBonus + sizeBonus + keywordBonus),
      });
    }

    return candidates;
  });

  const deduped = rawAnchors
    .sort((a, b) => b.priority - a.priority)
    .filter((anchor) => anchor.width > 0 && anchor.height > 0);

  /** @type {import('./types.mjs').AttentionAnchor[]} */
  const result = [];
  for (const anchor of deduped) {
    const overlapsExisting = result.some((existing) => intersectionOverUnion(anchor, existing) > 0.82);
    if (overlapsExisting) continue;

    result.push({
      id: hash(
        [
          anchor.kind,
          anchor.tagName,
          anchor.role,
          anchor.label,
          Math.round(anchor.x * 1000),
          Math.round(anchor.y * 1000),
          Math.round(anchor.width * 1000),
          Math.round(anchor.height * 1000),
        ].join("|")
      ),
      ...anchor,
    });

    if (result.length >= 24) break;
  }

  return result;
}

/**
 * @param {{x:number; y:number; width:number; height:number}} a
 * @param {{x:number; y:number; width:number; height:number}} b
 */
function intersectionOverUnion(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlapWidth = Math.max(0, right - left);
  const overlapHeight = Math.max(0, bottom - top);
  const intersection = overlapWidth * overlapHeight;
  if (!intersection) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * @param {string} input
 */
function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 10);
}
