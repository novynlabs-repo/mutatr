import { query } from "@anthropic-ai/claude-agent-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SCORE_METRICS = [
  ["messageClarity", "Message clarity"],
  ["ctaClarity", "CTA clarity"],
  ["trustVisibility", "Trust visibility"],
  ["distractionControl", "Distraction control"],
  ["informationHierarchy", "Information hierarchy"],
  ["personaFit", "Persona fit"],
  ["frictionReduction", "Friction reduction"],
  ["accessibilitySafety", "Accessibility safety"],
  ["mobileResilience", "Mobile resilience"],
  ["performanceSafety", "Performance safety"],
];

/**
 * @param {{
 * cwd: string;
 * prompt: string;
 * schema?: Record<string, unknown>;
 * apiKey?: string;
 * permissionMode?: import('@anthropic-ai/claude-agent-sdk').PermissionMode;
 * maxTurns?: number;
 * systemAppend?: string;
 * additionalDirectories?: string[];
 * model?: string;
 * onMessage?: (text: string) => void;
 * }} input
 */
async function runClaude(input) {
  const {
    cwd,
    prompt,
    schema,
    apiKey,
    permissionMode = "dontAsk",
    maxTurns = 8,
    systemAppend,
    additionalDirectories = [],
    model,
    onMessage,
  } = input;

  /** @type {import('@anthropic-ai/claude-agent-sdk').SDKResultMessage | null} */
  let resultMessage = null;

  const options = {
    cwd,
    additionalDirectories,
    permissionMode,
    maxTurns,
    outputFormat: schema ? { type: "json_schema", schema } : undefined,
    systemPrompt: systemAppend
      ? {
          type: "preset",
          preset: "claude_code",
          append: systemAppend,
        }
      : undefined,
    includePartialMessages: true,
    settingSources: ["project"],
    model,
    env: {
      ...process.env,
      ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
    },
  };

  const stream = query({ prompt, options });

  for await (const message of stream) {
    if (message.type === "result") {
      resultMessage = message;
    } else if (onMessage && message.type === "stream_event") {
      const text = extractStreamDelta(message.event);
      if (text) onMessage(text);
    }
  }

  if (!resultMessage) {
    throw new Error("No result returned by Claude Agent SDK.");
  }

  if (resultMessage.subtype !== "success") {
    throw new Error(resultMessage.errors?.join("\n") || "Claude query failed.");
  }

  return {
    text: resultMessage.result,
    structured: resultMessage.structured_output,
  };
}

/**
 * @param {{ projectName: string; projectRoot: string; pages: {route:string; filePath:string}[]; apiKey?: string; model?: string }} input
 */
export async function suggestPersonas(input) {
  const { projectName, projectRoot, pages, apiKey, model } = input;
  if (isMockClaudeEnabled()) {
    return defaultPersonas();
  }

  const schema = {
    type: "object",
    properties: {
      personas: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            summary: { type: "string" },
            ageBand: { type: "string" },
            motivations: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 5,
            },
            painPoints: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 5,
            },
            tone: { type: "string" },
            preferredChannels: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 4,
            },
          },
          required: [
            "name",
            "summary",
            "ageBand",
            "motivations",
            "painPoints",
            "tone",
            "preferredChannels",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["personas"],
    additionalProperties: false,
  };

  const prompt = [
    `You are helping configure a product experimentation app for the codebase \"${projectName}\".`,
    "Infer realistic synthetic user personas from the likely product context and page routes.",
    "Return concrete and varied personas useful for A/B testing and attention analysis.",
    "",
    "Known routes:",
    ...pages.slice(0, 40).map((p) => `- ${p.route} (${p.filePath})`),
  ].join("\n");

  try {
    const result = await runClaude({
      cwd: projectRoot,
      prompt,
      schema,
      apiKey,
      model,
      maxTurns: 6,
      systemAppend:
        "Be concise, practical, and avoid generic personas. Focus on conversion-relevant behavior.",
    });

    const typed = /** @type {{ personas: any[] }} */ (result.structured);

    return typed.personas.map((persona) => ({
      id: hash(`${persona.name}-${persona.ageBand}-${Math.random()}`),
      name: persona.name,
      summary: persona.summary,
      ageBand: persona.ageBand,
      motivations: persona.motivations,
      painPoints: persona.painPoints,
      tone: persona.tone,
      preferredChannels: persona.preferredChannels,
    }));
  } catch {
    return defaultPersonas();
  }
}

/**
 * @param {{
 * projectRoot: string;
 * projectName: string;
 * page: {route:string; filePath:string};
 * pageSource: string;
 * personas: {name:string; summary:string; motivations:string[]}[];
 * goal?: string;
 * apiKey?: string;
 * model?: string;
 * onMessage?: (text: string) => void;
 * }} input
 */
export async function suggestTests(input) {
  const { projectRoot, projectName, page, pageSource, personas, goal, apiKey, model, onMessage } = input;
  if (isMockClaudeEnabled()) {
    return [
      {
        id: hash(`mock-${page.route}-cta`),
        title: "Clarify primary CTA",
        hypothesis: "A specific CTA increases focused clicks.",
        expectedImpact: "Improved primary CTA click-through rate.",
        implementationPrompt:
          "Adjust the primary CTA label to be explicit and value-focused while keeping current styling.",
        riskLevel: "low",
      },
      {
        id: hash(`mock-${page.route}-proof`),
        title: "Elevate trust signal placement",
        hypothesis: "Visible trust indicators reduce hesitation.",
        expectedImpact: "Higher engagement depth and lower bounce rate.",
        implementationPrompt:
          "Move trust signal content above the fold and tighten surrounding spacing.",
        riskLevel: "medium",
      },
      {
        id: hash(`mock-${page.route}-hierarchy`),
        title: "Tighten visual hierarchy",
        hypothesis: "Sharper hierarchy improves scanability and conversion.",
        expectedImpact: "Faster comprehension and more CTA interaction.",
        implementationPrompt:
          "Increase contrast and spacing between headline, supporting copy, and call to action.",
        riskLevel: "medium",
      },
    ];
  }

  const schema = {
    type: "object",
    properties: {
      tests: {
        type: "array",
        minItems: 3,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            hypothesis: { type: "string" },
            expectedImpact: { type: "string" },
            implementationPrompt: { type: "string" },
            riskLevel: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: [
            "title",
            "hypothesis",
            "expectedImpact",
            "implementationPrompt",
            "riskLevel",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["tests"],
    additionalProperties: false,
  };

  const promptLines = [
    `Generate A/B test ideas for route ${page.route} in project ${projectName}.`,
    "Focus on conversion and engagement improvements.",
    "Output tests that are implementation-ready for an autonomous coding agent.",
  ];
  if (goal) {
    promptLines.push("", `Page goal/objective: ${goal}`);
  }
  promptLines.push(
    "",
    "Top personas:",
    ...personas.slice(0, 4).map((p) => `- ${p.name}: ${p.summary}. Motivations: ${p.motivations.join(", ")}`),
    "",
    "Page source snippet:",
    "```",
    pageSource.slice(0, 14000),
    "```",
  );
  const prompt = promptLines.join("\n");

  try {
    const result = await runClaude({
      cwd: projectRoot,
      prompt,
      schema,
      apiKey,
      model,
      maxTurns: 7,
      systemAppend:
        "Prioritize practical tests that can be implemented in under 30 lines each whenever possible.",
      onMessage,
    });

    const typed = /** @type {{ tests: any[] }} */ (result.structured);
    return typed.tests.map((test) => ({
      id: hash(`${page.route}-${test.title}-${Math.random()}`),
      title: test.title,
      hypothesis: test.hypothesis,
      expectedImpact: test.expectedImpact,
      implementationPrompt: test.implementationPrompt,
      riskLevel: test.riskLevel,
    }));
  } catch {
    return [
      {
        id: hash(`fallback-${page.route}-cta`),
        title: "Strengthen hero CTA copy",
        hypothesis: "A clearer value-based CTA will improve primary click-through rate.",
        expectedImpact: "Higher click-through on the main call to action.",
        implementationPrompt:
          "Update the primary CTA copy on this page to be more explicit about value and urgency. Keep style consistent.",
        riskLevel: "low",
      },
      {
        id: hash(`fallback-${page.route}-proof`),
        title: "Surface social proof earlier",
        hypothesis: "Showing trust signals above the fold increases conversion confidence.",
        expectedImpact: "Higher engagement and lower bounce rate.",
        implementationPrompt:
          "Add lightweight social proof (customer logos or testimonial snippet) above the fold without breaking layout.",
        riskLevel: "medium",
      },
      {
        id: hash(`fallback-${page.route}-form`),
        title: "Reduce form friction",
        hypothesis: "Fewer mandatory fields improve form completion.",
        expectedImpact: "Improved lead conversion rate.",
        implementationPrompt:
          "Create a variant of the current form with reduced visible mandatory fields and clearer helper text.",
        riskLevel: "medium",
      },
    ];
  }
}

/**
 * @param {{
 * projectRoot: string;
 * page: {route:string; filePath:string};
 * test: {title:string; implementationPrompt:string};
 * apiKey?: string;
 * model?: string;
 * onMessage?: (text: string) => void;
 * }} input
 */
export async function implementTest(input) {
  const { projectRoot, page, test, apiKey, model, onMessage } = input;
  if (isMockClaudeEnabled()) {
    return {
      summary: `Mock implementation applied for "${test.title}"`,
      changedFiles: [page.filePath],
    };
  }

  const schema = {
    type: "object",
    properties: {
      summary: { type: "string" },
      changedFiles: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["summary", "changedFiles"],
    additionalProperties: false,
  };

  const prompt = [
    `Implement this A/B test variant in the codebase for page route ${page.route}.`,
    `Primary page file: ${page.filePath}.`,
    `Test title: ${test.title}`,
    `Instructions: ${test.implementationPrompt}`,
    "",
    "Constraints:",
    "- Keep existing design language and coding style.",
    "- Apply a variant implementation directly in project files.",
    "- Do not break TypeScript or build config.",
    "- Return structured output with summary and changed file list.",
    "- Every changed file path must be repo-relative (for example: src/app/page.tsx).",
    "- Do not return absolute paths, home-directory paths, or paths outside the current project root.",
  ].join("\n");

  const result = await runClaude({
    cwd: projectRoot,
    prompt,
    schema,
    apiKey,
    model,
    permissionMode: "acceptEdits",
    maxTurns: 18,
    systemAppend:
      "You are implementing code changes directly. Make concrete edits; do not just describe them.",
    additionalDirectories: [projectRoot],
    onMessage,
  });

  const typed = /** @type {{summary:string; changedFiles:string[]}} */ (result.structured);

  return {
    summary: typed.summary,
    changedFiles: typed.changedFiles,
  };
}

/**
 * @param {{
 * projectRoot: string;
 * pageRoute: string;
 * persona: {name:string; summary:string; motivations:string[]};
 * variantTitle: string;
 * screenshotPath?: string;
 * screenshotDataUrl?: string;
 * anchors?: import('./types.mjs').AttentionAnchor[];
 * visitors?: number;
 * apiKey?: string;
 * model?: string;
 * onMessage?: (text: string) => void;
 * }} input
 */
export async function predictAttentionBoxes(input) {
  const visitors = input.visitors ?? 10;
  const anchors = sanitizeAnchors(input.anchors ?? []);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mutatr-attention-"));

  try {
    const screenshotPath = await ensureScreenshotPath(
      input.screenshotPath,
      input.screenshotDataUrl,
      tempDir
    );

    if (isMockClaudeEnabled()) {
      const fallback = fallbackAttentionFromAnchors(anchors, input.persona);
      return {
        rationale: "Mock attention distribution generated from rendered anchors for E2E validation.",
        boxes: fallback.boxes,
      };
    }

    const visitorPromises = Array.from({ length: visitors }, (_, v) =>
      predictAttentionForVisitor({
        ...input,
        anchors,
        screenshotPath,
        visitorIndex: v,
        visitorCount: visitors,
      }).catch(() => fallbackAttentionFromAnchors(anchors, input.persona))
    );

    const results = await Promise.all(visitorPromises);

    /** @type {{x:number;y:number;width:number;height:number;weight:number}[]} */
    const allBoxes = [];
    let lastRationale = "";
    for (const r of results) {
      allBoxes.push(...r.boxes);
      if (r.rationale) lastRationale = r.rationale;
    }

    if (allBoxes.length > 0) {
      return {
        rationale: lastRationale || "Aggregated attention from multiple screenshot-grounded visitors.",
        boxes: allBoxes,
      };
    }

    const fallback = fallbackAttentionFromAnchors(anchors, input.persona);
    return {
      rationale:
        fallback.rationale || "Anchors were sparse, so attention fell back to deterministic DOM weighting.",
      boxes: fallback.boxes,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function defaultPersonas() {
  return [
    {
      id: hash("default-aldric"),
      name: "Aldric the Elder",
      summary: "Trust-oriented decision maker with low tolerance for confusing UX.",
      ageBand: "55-70",
      motivations: ["clarity", "safety", "human support"],
      painPoints: ["small text", "hidden pricing", "complex forms"],
      tone: "calm, explicit, reassuring",
      preferredChannels: ["email", "desktop web"],
    },
    {
      id: hash("default-finnegan"),
      name: "Finnegan the Young",
      summary: "Fast-scrolling mobile-native user seeking instant payoff.",
      ageBand: "16-24",
      motivations: ["speed", "visual novelty", "social proof"],
      painPoints: ["slow pages", "long copy", "boring UI"],
      tone: "concise, energetic",
      preferredChannels: ["mobile web", "social"],
    },
    {
      id: hash("default-ops-lead"),
      name: "Nadia the Ops Lead",
      summary: "Busy professional evaluating credibility and ROI quickly.",
      ageBand: "28-40",
      motivations: ["efficiency", "predictable outcomes", "proof"],
      painPoints: ["vague claims", "missing case studies", "unclear CTA"],
      tone: "direct, outcomes-first",
      preferredChannels: ["desktop web", "LinkedIn"],
    },
  ];
}

/**
 * Extract text delta from a BetaRawMessageStreamEvent.
 * @param {object} event
 * @returns {string}
 */
function extractStreamDelta(event) {
  if (!event) return "";
  if (event.type === "content_block_delta") {
    if (event.delta?.type === "text_delta") return event.delta.text || "";
    if (event.delta?.type === "input_json_delta") return event.delta.partial_json || "";
    if (event.delta?.type === "thinking_delta") return event.delta.thinking || "";
  }
  if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
    return `\n[tool: ${event.content_block.name}]\n`;
  }
  return "";
}

function isMockClaudeEnabled() {
  return process.env.MUTATR_MOCK_CLAUDE === "1";
}

/**
 * @param {{
 * projectRoot: string;
 * pageRoute: string;
 * persona: {name:string; summary:string; motivations:string[]};
 * variantTitle: string;
 * screenshotPath?: string;
 * anchors: import('./types.mjs').AttentionAnchor[];
 * visitorIndex: number;
 * visitorCount: number;
 * apiKey?: string;
 * model?: string;
 * onMessage?: (text: string) => void;
 * }} input
 */
async function predictAttentionForVisitor(input) {
  const { anchors, screenshotPath } = input;

  if (anchors.length > 0) {
    const schema = {
      type: "object",
      properties: {
        rationale: { type: "string" },
        anchors: {
          type: "array",
          minItems: Math.min(3, anchors.length),
          maxItems: Math.min(10, anchors.length),
          items: {
            type: "object",
            properties: {
              id: { type: "string", enum: anchors.map((anchor) => anchor.id) },
              weight: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["id", "weight"],
            additionalProperties: false,
          },
        },
      },
      required: ["rationale", "anchors"],
      additionalProperties: false,
    };

    const prompt = [
      `Predict first-glance visual attention for route ${input.pageRoute}.`,
      `Variant: ${input.variantTitle}`,
      `Persona: ${input.persona.name}: ${input.persona.summary}. Motivations: ${input.persona.motivations.join(", ")}`,
      `Visitor ${input.visitorIndex + 1} of ${input.visitorCount}. Vary the selection slightly across visitors.`,
      "",
      "You must inspect the actual rendered screenshot file before answering:",
      screenshotPath ? `- Screenshot: ${screenshotPath}` : "- Screenshot: unavailable",
      "",
      "Select only from these visible DOM anchors. They are normalized to the full-page screenshot:",
      ...anchors.map(
        (anchor) =>
          `- id=${anchor.id} kind=${anchor.kind} priority=${anchor.priority} box=(${anchor.x.toFixed(3)}, ${anchor.y.toFixed(3)}, ${anchor.width.toFixed(3)}, ${anchor.height.toFixed(3)}) label="${anchor.label}"`
      ),
      "",
      "Rules:",
      "- Use the screenshot to judge salience, hierarchy, and contrast.",
      "- Only return anchor ids from the list above.",
      "- Prefer what a human would notice first, not what a generic website should highlight.",
      "- Higher weights mean stronger likely first-glance attention.",
    ].join("\n");

    const result = await runClaude({
      cwd: input.projectRoot,
      prompt,
      schema,
      apiKey: input.apiKey,
      model: input.model,
      maxTurns: 9,
      systemAppend:
        "Inspect the provided screenshot file before answering. Ground attention in the actual rendered UI and select from the supplied anchor list only.",
      additionalDirectories: buildAdditionalDirectories(input.projectRoot, screenshotPath),
      onMessage: input.onMessage,
    });

    const typed = /** @type {{rationale:string; anchors:{id:string; weight:number}[]}} */ (result.structured);
    const selectedBoxes = anchorSelectionsToBoxes(typed.anchors, anchors);
    if (selectedBoxes.length > 0) {
      return {
        rationale: typed.rationale,
        boxes: selectedBoxes,
      };
    }
  }

  if (screenshotPath) {
    const schema = {
      type: "object",
      properties: {
        rationale: { type: "string" },
        boxes: {
          type: "array",
          minItems: 4,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              width: { type: "number", minimum: 0.03, maximum: 1 },
              height: { type: "number", minimum: 0.03, maximum: 1 },
              weight: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["x", "y", "width", "height", "weight"],
            additionalProperties: false,
          },
        },
      },
      required: ["rationale", "boxes"],
      additionalProperties: false,
    };

    const prompt = [
      `Predict first-glance visual attention for route ${input.pageRoute}.`,
      `Variant: ${input.variantTitle}`,
      `Persona: ${input.persona.name}: ${input.persona.summary}. Motivations: ${input.persona.motivations.join(", ")}`,
      `Visitor ${input.visitorIndex + 1} of ${input.visitorCount}.`,
      "",
      "You must inspect the actual rendered screenshot file before answering:",
      `- Screenshot: ${screenshotPath}`,
      "",
      "Return normalized attention boxes for the areas most likely to attract attention first.",
    ].join("\n");

    const result = await runClaude({
      cwd: input.projectRoot,
      prompt,
      schema,
      apiKey: input.apiKey,
      model: input.model,
      maxTurns: 9,
      systemAppend:
        "Inspect the provided screenshot file before answering. Ground coordinates in the actual rendered UI, not generic website priors.",
      additionalDirectories: buildAdditionalDirectories(input.projectRoot, screenshotPath),
      onMessage: input.onMessage,
    });

    const typed = /** @type {{rationale:string; boxes:{x:number;y:number;width:number;height:number;weight:number}[]}} */ (
      result.structured
    );
    return {
      rationale: typed.rationale,
      boxes: typed.boxes.map((box) => ({
        x: clamp01(box.x),
        y: clamp01(box.y),
        width: clampRange(box.width, 0.03, 1),
        height: clampRange(box.height, 0.03, 1),
        weight: clamp01(box.weight),
      })),
    };
  }

  return fallbackAttentionFromAnchors(anchors, input.persona);
}

/**
 * @param {string | undefined} screenshotPath
 * @param {string | undefined} screenshotDataUrl
 * @param {string} tempDir
 */
async function ensureScreenshotPath(screenshotPath, screenshotDataUrl, tempDir) {
  if (screenshotPath) {
    try {
      await fs.stat(screenshotPath);
      return screenshotPath;
    } catch {
      // Fall through to rematerialize from data URL.
    }
  }

  if (!screenshotDataUrl) return "";

  const match = screenshotDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return "";

  const ext = mimeToExtension(match[1]);
  const outFile = path.join(tempDir, `attention-render.${ext}`);
  await fs.writeFile(outFile, Buffer.from(match[2], "base64"));
  return outFile;
}

/**
 * @param {string} projectRoot
 * @param {...(string | undefined)} screenshotPaths
 */
function buildAdditionalDirectories(projectRoot, ...screenshotPaths) {
  return [
    ...new Set(
      [projectRoot, ...screenshotPaths.map((screenshotPath) => (screenshotPath ? path.dirname(screenshotPath) : ""))]
        .filter(Boolean)
    ),
  ];
}

/**
 * @param {{id:string; weight:number}[]} selections
 * @param {import('./types.mjs').AttentionAnchor[]} anchors
 */
function anchorSelectionsToBoxes(selections, anchors) {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));
  /** @type {{x:number; y:number; width:number; height:number; weight:number}[]} */
  const boxes = [];
  const seen = new Set();

  for (const selection of selections) {
    const anchor = byId.get(selection.id);
    if (!anchor || seen.has(anchor.id)) continue;
    seen.add(anchor.id);
    boxes.push({
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
      weight: clamp01(selection.weight),
    });
  }

  return boxes;
}

/**
 * @param {import('./types.mjs').AttentionAnchor[]} anchors
 * @param {{name:string; summary:string; motivations:string[]}} persona
 */
function fallbackAttentionFromAnchors(anchors, persona) {
  if (!anchors.length) {
    return {
      rationale: "No rendered anchors were available, so attention fell back to a generic center-weighted estimate.",
      boxes: [
        { x: 0.18, y: 0.08, width: 0.62, height: 0.22, weight: 0.88 },
        { x: 0.28, y: 0.34, width: 0.42, height: 0.18, weight: 0.74 },
        { x: 0.55, y: 0.55, width: 0.22, height: 0.18, weight: 0.62 },
        { x: 0.12, y: 0.55, width: 0.28, height: 0.16, weight: 0.48 },
      ],
    };
  }

  const topAnchors = [...anchors]
    .map((anchor) => ({
      anchor,
      score: scoreAnchorForPersona(anchor, persona),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    rationale:
      "Claude image analysis was unavailable, so attention was estimated from the rendered DOM anchors using role, position, and persona-weighted salience.",
    boxes: topAnchors.map(({ anchor, score }, index) => ({
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
      weight: clampRange((score - index * 0.03) / 100, 0.15, 0.95),
    })),
  };
}

/**
 * @param {import('./types.mjs').AttentionAnchor} anchor
 * @param {{motivations:string[]}} persona
 */
function scoreAnchorForPersona(anchor, persona) {
  const motivations = (persona.motivations ?? []).join(" ").toLowerCase();
  let score = anchor.priority;

  if (anchor.kind === "cta" && /\b(speed|action|efficiency|clarity|instant)\b/.test(motivations)) score += 10;
  if (anchor.kind === "proof" && /\b(trust|safety|proof|roi|credibility)\b/.test(motivations)) score += 10;
  if (anchor.kind === "headline" && /\b(clarity|outcome|value)\b/.test(motivations)) score += 8;
  if (anchor.kind === "form" && /\b(sign up|apply|buy|convert|action)\b/.test(motivations)) score += 6;
  if (anchor.y < 0.2) score += 8;
  else if (anchor.y < 0.45) score += 4;

  return score;
}

/**
 * @param {import('./types.mjs').AttentionAnchor[]} anchors
 */
function sanitizeAnchors(anchors) {
  return anchors
    .filter((anchor) => anchor && typeof anchor.id === "string")
    .map((anchor) => ({
      ...anchor,
      label: String(anchor.label ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
      x: clamp01(anchor.x),
      y: clamp01(anchor.y),
      width: clampRange(anchor.width, 0.01, 1),
      height: clampRange(anchor.height, 0.01, 1),
      priority: Number.isFinite(anchor.priority) ? anchor.priority : 0,
    }));
}

/**
 * @param {string} mime
 */
function mimeToExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

/**
 * @param {number} value
 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clampRange(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {{
 * projectRoot: string;
 * pageRoute: string;
 * persona: {id?:string; name:string; summary:string; motivations:string[]};
 * variantTitle: string;
 * goal?: string | null;
 * controlScreenshotPath?: string;
 * controlScreenshotDataUrl?: string;
 * controlMobileScreenshotPath?: string;
 * controlMobileScreenshotDataUrl?: string;
 * controlAnchors?: import('./types.mjs').AttentionAnchor[];
 * controlMobileAnchors?: import('./types.mjs').AttentionAnchor[];
 * controlBoxes?: {x:number; y:number; width:number; height:number; weight:number;}[];
 * variantScreenshotPath?: string;
 * variantScreenshotDataUrl?: string;
 * variantMobileScreenshotPath?: string;
 * variantMobileScreenshotDataUrl?: string;
 * variantAnchors?: import('./types.mjs').AttentionAnchor[];
 * variantMobileAnchors?: import('./types.mjs').AttentionAnchor[];
 * variantBoxes?: {x:number; y:number; width:number; height:number; weight:number;}[];
 * changedFiles?: string[];
 * apiKey?: string;
 * model?: string;
 * onMessage?: (text: string) => void;
 * }} input
 */
export async function analyzeVariantScorecard(input) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mutatr-scorecard-"));
  const controlAnchors = sanitizeAnchors(input.controlAnchors ?? []);
  const variantAnchors = sanitizeAnchors(input.variantAnchors ?? []);
  const controlMobileAnchors = sanitizeAnchors(input.controlMobileAnchors ?? []);
  const variantMobileAnchors = sanitizeAnchors(input.variantMobileAnchors ?? []);
  const controlBoxes = sanitizeBoxes(input.controlBoxes ?? []);
  const variantBoxes = sanitizeBoxes(input.variantBoxes ?? []);
  const goalProfile = deriveGoalProfile(input.goal);
  const fallbackScorecard = buildFallbackScorecard({
    goalProfile,
    persona: input.persona,
    variantTitle: input.variantTitle,
    controlAnchors,
    controlMobileAnchors,
    controlBoxes,
    variantAnchors,
    variantMobileAnchors,
    variantBoxes,
    changedFiles: input.changedFiles ?? [],
  });

  try {
    const [
      controlDesktopPath,
      controlMobilePath,
      variantDesktopPath,
      variantMobilePath,
    ] = await Promise.all([
      ensureScreenshotPath(input.controlScreenshotPath, input.controlScreenshotDataUrl, tempDir),
      ensureScreenshotPath(input.controlMobileScreenshotPath, input.controlMobileScreenshotDataUrl, tempDir),
      ensureScreenshotPath(input.variantScreenshotPath, input.variantScreenshotDataUrl, tempDir),
      ensureScreenshotPath(input.variantMobileScreenshotPath, input.variantMobileScreenshotDataUrl, tempDir),
    ]);

    if (isMockClaudeEnabled()) {
      return finalizeScorecard(fallbackScorecard, fallbackScorecard, goalProfile);
    }

    const schema = buildScorecardSchema();
    const prompt = [
      `Compare the control page and variant "${input.variantTitle}" for route ${input.pageRoute}.`,
      `Persona: ${input.persona.name}: ${input.persona.summary}. Motivations: ${input.persona.motivations.join(", ")}`,
      goalProfile.goal
        ? `Experiment goal: ${goalProfile.goal}`
        : "Experiment goal: none supplied. Use a balanced experimentation lens.",
      `Priority metrics: ${goalProfile.priorityMetrics.map(metricLabel).join(", ")}`,
      "",
      "Inspect these rendered screenshots before scoring:",
      controlDesktopPath ? `- Control desktop: ${controlDesktopPath}` : "- Control desktop: unavailable",
      variantDesktopPath ? `- Variant desktop: ${variantDesktopPath}` : "- Variant desktop: unavailable",
      controlMobilePath ? `- Control mobile: ${controlMobilePath}` : "- Control mobile: unavailable",
      variantMobilePath ? `- Variant mobile: ${variantMobilePath}` : "- Variant mobile: unavailable",
      "",
      "Desktop control anchors:",
      ...summarizeAnchors(controlAnchors),
      "",
      "Desktop variant anchors:",
      ...summarizeAnchors(variantAnchors),
      "",
      "Mobile control anchors:",
      ...summarizeAnchors(controlMobileAnchors),
      "",
      "Mobile variant anchors:",
      ...summarizeAnchors(variantMobileAnchors),
      "",
      "Control attention hotspots:",
      ...summarizeFocusSignals(controlAnchors, controlBoxes),
      "",
      "Variant attention hotspots:",
      ...summarizeFocusSignals(variantAnchors, variantBoxes),
      "",
      `Changed files (${input.changedFiles?.length ?? 0}): ${(input.changedFiles ?? []).slice(0, 8).join(", ") || "none recorded"}`,
      "",
      "Scoring rules:",
      "- Score each metric from 0-100, where higher is better for the variant.",
      "- `deltaFromControl` should be positive if the variant is better than control, negative if worse.",
      "- Be conservative: this is synthetic directional analysis, not live conversion data.",
      "- Let the explicit experiment goal change what matters most when you judge likely win potential.",
      "- The mobile resilience score must reflect what changes between desktop and mobile screenshots.",
      "- The performance safety score must reflect likely visual and structural weight, not absolute bundle metrics.",
      "- Detect the concrete issues still blocking this variant and explain the most meaningful diffs from control.",
      "- Provide concrete strengths, risks, recommendations, issues, and diff explanations.",
    ].join("\n");

    const result = await runClaude({
      cwd: input.projectRoot,
      prompt,
      schema,
      apiKey: input.apiKey,
      model: input.model,
      maxTurns: 10,
      systemAppend:
        "Inspect the provided control and variant screenshots before answering. Return a concise, directional experimentation scorecard grounded in the actual UI.",
      additionalDirectories: buildAdditionalDirectories(
        input.projectRoot,
        controlDesktopPath,
        controlMobilePath,
        variantDesktopPath,
        variantMobilePath
      ),
      onMessage: input.onMessage,
    });

    const typed = /** @type {{
     * summary:string;
     * verdict:"win"|"mixed"|"risk";
     * diffSummary:string;
     * confidenceLabel:"directional"|"moderate"|"high";
     * confidenceScore:number;
     * strengths:string[];
     * risks:string[];
     * recommendations:string[];
     * issues:Array<{title:string; severity:"low"|"medium"|"high"; description:string; recommendation:string; metricKey?:string;}>;
     * diff:{summary:string; likelyImpact:string; changes:Array<{title:string; type:string; impact:string; description:string;}>;};
     * evidenceMix:{visual:number; structural:number; heuristic:number;};
     * metrics: Record<string, {score:number; deltaFromControl:number; rationale:string;}>;
     * }} */ (result.structured);

    return finalizeScorecard(typed, fallbackScorecard, goalProfile);
  } catch {
    return finalizeScorecard(fallbackScorecard, fallbackScorecard, goalProfile);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildScorecardSchema() {
  /** @type {Record<string, unknown>} */
  const metricProps = {};
  /** @type {string[]} */
  const metricKeys = [];
  const scoreMetricKeys = SCORE_METRICS.map(([key]) => key);

  for (const [key] of SCORE_METRICS) {
    metricKeys.push(key);
    metricProps[key] = {
      type: "object",
      properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        deltaFromControl: { type: "number", minimum: -100, maximum: 100 },
        rationale: { type: "string" },
      },
      required: ["score", "deltaFromControl", "rationale"],
      additionalProperties: false,
    };
  }

  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      verdict: { type: "string", enum: ["win", "mixed", "risk"] },
      diffSummary: { type: "string" },
      confidenceLabel: { type: "string", enum: ["directional", "moderate", "high"] },
      confidenceScore: { type: "number", minimum: 0, maximum: 100 },
      strengths: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: { type: "string" },
      },
      risks: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: { type: "string" },
      },
      recommendations: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: { type: "string" },
      },
      issues: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high"] },
            description: { type: "string" },
            recommendation: { type: "string" },
            metricKey: { type: "string", enum: scoreMetricKeys },
          },
          required: ["title", "severity", "description", "recommendation"],
          additionalProperties: false,
        },
      },
      diff: {
        type: "object",
        properties: {
          summary: { type: "string" },
          likelyImpact: { type: "string" },
          changes: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                type: { type: "string", enum: ["copy", "hierarchy", "cta", "trust", "form", "media", "layout"] },
                impact: { type: "string", enum: ["positive", "mixed", "negative"] },
                description: { type: "string" },
              },
              required: ["title", "type", "impact", "description"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "likelyImpact", "changes"],
        additionalProperties: false,
      },
      evidenceMix: {
        type: "object",
        properties: {
          visual: { type: "number", minimum: 0, maximum: 100 },
          structural: { type: "number", minimum: 0, maximum: 100 },
          heuristic: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["visual", "structural", "heuristic"],
        additionalProperties: false,
      },
      metrics: {
        type: "object",
        properties: metricProps,
        required: metricKeys,
        additionalProperties: false,
      },
    },
    required: [
      "summary",
      "verdict",
      "diffSummary",
      "confidenceLabel",
      "confidenceScore",
      "strengths",
      "risks",
      "recommendations",
      "issues",
      "diff",
      "evidenceMix",
      "metrics",
    ],
    additionalProperties: false,
  };
}

/**
 * @param {{
 * goalProfile: ReturnType<typeof deriveGoalProfile>;
 * persona: {name:string; motivations:string[]};
 * variantTitle: string;
 * controlAnchors: import('./types.mjs').AttentionAnchor[];
 * controlMobileAnchors: import('./types.mjs').AttentionAnchor[];
 * controlBoxes: {x:number; y:number; width:number; height:number; weight:number;}[];
 * variantAnchors: import('./types.mjs').AttentionAnchor[];
 * variantMobileAnchors: import('./types.mjs').AttentionAnchor[];
 * variantBoxes: {x:number; y:number; width:number; height:number; weight:number;}[];
 * changedFiles: string[];
 * }} input
 */
function buildFallbackScorecard(input) {
  const control = deriveHeuristicMetrics({
    anchors: input.controlAnchors,
    mobileAnchors: input.controlMobileAnchors,
    boxes: input.controlBoxes,
    persona: input.persona,
  });
  const variant = deriveHeuristicMetrics({
    anchors: input.variantAnchors,
    mobileAnchors: input.variantMobileAnchors,
    boxes: input.variantBoxes,
    persona: input.persona,
  });

  /** @type {Record<string, {score:number; deltaFromControl:number; rationale:string}>} */
  const metrics = {};
  let positiveCount = 0;
  let negativeCount = 0;

  for (const [key, label] of SCORE_METRICS) {
    const score = roundScore(variant[key] ?? 50);
    const baseline = roundScore(control[key] ?? 50);
    const delta = roundScore(score - baseline);
    if (delta >= 4) positiveCount += 1;
    else if (delta <= -4) negativeCount += 1;
    metrics[key] = {
      score,
      deltaFromControl: delta,
      rationale: buildMetricRationale(label, score, baseline, input.variantTitle),
    };
  }

  const verdict = positiveCount >= 5 && negativeCount <= 2
    ? "win"
    : negativeCount >= 4
      ? "risk"
      : "mixed";

  const strengths = deriveFallbackBullets(metrics, "positive");
  const risks = deriveFallbackBullets(metrics, "negative");
  const recommendations = deriveFallbackRecommendations(metrics);
  const issues = buildFallbackIssues({
    goalProfile: input.goalProfile,
    metrics,
    variantAnchors: input.variantAnchors,
    variantMobileAnchors: input.variantMobileAnchors,
  });
  const diff = buildFallbackDiff({
    goalProfile: input.goalProfile,
    variantTitle: input.variantTitle,
    controlAnchors: input.controlAnchors,
    controlMobileAnchors: input.controlMobileAnchors,
    variantAnchors: input.variantAnchors,
    variantMobileAnchors: input.variantMobileAnchors,
    metrics,
    changedFiles: input.changedFiles,
  });
  const goalAlignment = buildGoalAlignment(metrics, input.goalProfile);

  return {
    summary: verdict === "win"
      ? `${input.variantTitle} looks stronger for ${input.persona.name}, especially in clarity and conversion cues.`
      : verdict === "risk"
        ? `${input.variantTitle} introduces several directional risks for ${input.persona.name}, despite some visible gains.`
        : `${input.variantTitle} is mixed for ${input.persona.name}: some cues improve, but the overall experience is not uniformly stronger than control.`,
    verdict,
    diffSummary: `Compared with control, ${input.variantTitle} shifts emphasis across headline, CTA, trust, and layout cues in a way that changes how the page scans for ${input.persona.name}.`,
    goalAlignment,
    confidenceLabel: "directional",
    confidenceScore: 58,
    strengths,
    risks,
    recommendations,
    issues,
    diff,
    evidenceMix: { visual: 52, structural: 32, heuristic: 16 },
    metrics,
  };
}

/**
 * @param {{
 * anchors: import('./types.mjs').AttentionAnchor[];
 * mobileAnchors: import('./types.mjs').AttentionAnchor[];
 * boxes: {x:number; y:number; width:number; height:number; weight:number;}[];
 * persona: {motivations:string[]};
 * }} input
 */
function deriveHeuristicMetrics(input) {
  const ctaAnchors = input.anchors.filter((anchor) => anchor.kind === "cta" || anchor.kind === "interactive");
  const trustAnchors = input.anchors.filter((anchor) => anchor.kind === "proof");
  const headlineAnchors = input.anchors.filter((anchor) => anchor.kind === "headline");
  const formAnchors = input.anchors.filter((anchor) => anchor.kind === "form");
  const mediaAnchors = input.anchors.filter((anchor) => anchor.kind === "media");
  const topFocus = summarizeFocusScores(input.anchors, input.boxes);
  const focusOnPrimaryCta = topFocus.find((entry) => entry.anchor.kind === "cta" || entry.anchor.kind === "interactive")?.focus ?? 0;
  const focusOnHeadline = topFocus.find((entry) => entry.anchor.kind === "headline")?.focus ?? 0;
  const focusOnTrust = topFocus.find((entry) => entry.anchor.kind === "proof")?.focus ?? 0;
  const avgAboveFold = average(input.anchors.map((anchor) => (anchor.y < 0.42 ? 1 : 0)));
  const mobilePrimaryRetention = primaryAnchorRetention(input.anchors, input.mobileAnchors);
  const personaKeywordScore = keywordMatchScore(input.anchors, input.persona.motivations ?? []);

  return {
    messageClarity: 50 + headlineAnchors.length * 8 + focusOnHeadline * 16 + avgAboveFold * 10,
    ctaClarity: 48 + ctaAnchors.length * 9 + focusOnPrimaryCta * 22 - Math.max(0, ctaAnchors.length - 2) * 6,
    trustVisibility: 42 + trustAnchors.length * 12 + focusOnTrust * 18,
    distractionControl: 72 - Math.max(0, mediaAnchors.length - 1) * 7 - Math.max(0, ctaAnchors.length - 2) * 6,
    informationHierarchy: 50 + avgAboveFold * 12 + focusOnHeadline * 10 + focusOnPrimaryCta * 12,
    personaFit: 46 + personaKeywordScore * 28,
    frictionReduction: 72 - Math.max(0, formAnchors.length - 1) * 10 - Math.max(0, ctaAnchors.length - 3) * 4,
    accessibilitySafety: 58 + clampRange(average(input.anchors.map((anchor) => Math.min(anchor.width * 3.5, 1))), 0, 1) * 18,
    mobileResilience: 44 + mobilePrimaryRetention * 36,
    performanceSafety: 76 - Math.max(0, input.anchors.length - 14) * 1.5 - mediaAnchors.length * 4,
  };
}

/**
 * @param {{anchor: import('./types.mjs').AttentionAnchor; focus:number}[]} scoredAnchors
 */
function primaryAnchorRetention(desktopAnchors, mobileAnchors) {
  const desktopPrimary = desktopAnchors
    .filter((anchor) => anchor.kind === "headline" || anchor.kind === "cta" || anchor.kind === "proof")
    .slice(0, 6);
  if (!desktopPrimary.length) return 0.5;

  let retained = 0;
  for (const anchor of desktopPrimary) {
    const match = mobileAnchors.find((mobileAnchor) => mobileAnchor.kind === anchor.kind && similarLabel(anchor.label, mobileAnchor.label));
    if (match) retained += 1;
  }
  return retained / desktopPrimary.length;
}

function keywordMatchScore(anchors, motivations) {
  const words = motivations
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
  if (!words.length || !anchors.length) return 0.4;
  const text = anchors.map((anchor) => anchor.label.toLowerCase()).join(" ");
  let hits = 0;
  for (const word of words) {
    if (text.includes(word)) hits += 1;
  }
  return clampRange(hits / words.length, 0, 1);
}

function buildMetricRationale(label, score, baseline, variantTitle) {
  if (score >= baseline + 6) {
    return `${label} is stronger in ${variantTitle} than control based on the rendered hierarchy and visible cues.`;
  }
  if (score <= baseline - 6) {
    return `${label} is weaker in ${variantTitle} than control based on the rendered hierarchy and visible cues.`;
  }
  return `${label} is broadly similar to control, with only a small directional change in ${variantTitle}.`;
}

function deriveFallbackBullets(metrics, mode) {
  const sorted = Object.entries(metrics)
    .sort((a, b) =>
      mode === "positive"
        ? b[1].deltaFromControl - a[1].deltaFromControl
        : a[1].deltaFromControl - b[1].deltaFromControl
    )
    .slice(0, 3);

  return sorted.map(([key, metric]) => {
    const label = SCORE_METRICS.find(([metricKey]) => metricKey === key)?.[1] ?? key;
    if (mode === "positive") return `${label} improved by ${signed(metric.deltaFromControl)} points versus control.`;
    return `${label} dropped by ${Math.abs(metric.deltaFromControl)} points versus control.`;
  });
}

function deriveFallbackRecommendations(metrics) {
  const worst = Object.entries(metrics)
    .sort((a, b) => a[1].deltaFromControl - b[1].deltaFromControl)
    .slice(0, 3);

  return worst.map(([key]) => {
    switch (key) {
      case "messageClarity":
        return "Tighten the headline and supporting copy so the offer is understood faster.";
      case "ctaClarity":
        return "Reduce CTA ambiguity and reinforce a single primary next step above the fold.";
      case "trustVisibility":
        return "Bring proof and reassurance closer to the primary decision moment.";
      case "distractionControl":
        return "Remove competing visual pulls around the main conversion path.";
      case "informationHierarchy":
        return "Sharpen scan order from headline to proof to CTA.";
      case "personaFit":
        return "Align the variant copy more tightly to this persona’s top motivations and objections.";
      case "frictionReduction":
        return "Reduce form or decision friction around the main action.";
      case "accessibilitySafety":
        return "Strengthen legibility, tap targets, and clear semantic cues.";
      case "mobileResilience":
        return "Preserve the headline, proof, and CTA hierarchy more faithfully on mobile.";
      case "performanceSafety":
        return "Simplify heavy visual treatments that may add noise or weight without helping conversion.";
      default:
        return "Iterate the variant to reduce the weakest directional risk.";
    }
  });
}

function metricLabel(metricKey) {
  return SCORE_METRICS.find(([key]) => key === metricKey)?.[1] ?? metricKey;
}

function priorityMetricLabels(metricKeys) {
  return metricKeys.map((metricKey) => metricLabel(metricKey).toLowerCase()).join(", ");
}

function deriveGoalProfile(goal) {
  const normalizedGoal = typeof goal === "string" && goal.trim() ? goal.trim() : null;
  /** @type {Record<string, number>} */
  const weights = Object.fromEntries(SCORE_METRICS.map(([key]) => [key, 1]));
  const addWeight = (metricKeys, amount) => {
    for (const metricKey of metricKeys) {
      weights[metricKey] = (weights[metricKey] ?? 1) + amount;
    }
  };

  if (normalizedGoal) {
    const goalText = normalizedGoal.toLowerCase();

    if (/\b(sign[\s-]?up|signup|register|subscribe|lead|book|demo|trial|contact|apply)\b/.test(goalText)) {
      addWeight(["ctaClarity", "frictionReduction", "trustVisibility", "personaFit"], 2.8);
    }
    if (/\b(purchase|buy|checkout|revenue|sales|paid|order)\b/.test(goalText)) {
      addWeight(["ctaClarity", "trustVisibility", "frictionReduction", "performanceSafety"], 2.4);
    }
    if (/\b(bounce|engagement|scroll|time on page|retention|explore|read)\b/.test(goalText)) {
      addWeight(["messageClarity", "informationHierarchy", "distractionControl", "mobileResilience"], 2.2);
    }
    if (/\b(trust|credibility|confidence|assurance|proof|reassure)\b/.test(goalText)) {
      addWeight(["trustVisibility", "messageClarity", "informationHierarchy", "accessibilitySafety"], 2.4);
    }
    if (/\b(mobile|phone|app install|app)\b/.test(goalText)) {
      addWeight(["mobileResilience", "ctaClarity", "performanceSafety", "frictionReduction"], 2.1);
    }
    if (/\b(speed|performance|fast|load|lightweight)\b/.test(goalText)) {
      addWeight(["performanceSafety", "mobileResilience", "distractionControl"], 2.2);
    }
    if (/\b(clarity|message|value prop|value proposition|understand|comprehension)\b/.test(goalText)) {
      addWeight(["messageClarity", "informationHierarchy", "personaFit"], 2);
    }
  }

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  /** @type {Record<string, number>} */
  const normalizedWeights = {};
  for (const [metricKey, value] of Object.entries(weights)) {
    normalizedWeights[metricKey] = value / total;
  }

  const priorityMetrics = Object.entries(normalizedWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, normalizedGoal ? 4 : 3)
    .map(([metricKey]) => metricKey);

  return {
    goal: normalizedGoal,
    weights: normalizedWeights,
    priorityMetrics,
    summary: normalizedGoal
      ? `Optimizing for "${normalizedGoal}" with extra emphasis on ${priorityMetricLabels(priorityMetrics)}.`
      : `No explicit goal set. Using a balanced lens across ${priorityMetricLabels(priorityMetrics)}.`,
  };
}

function weightedMetricAverage(metrics, field, weights) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [metricKey, metric] of Object.entries(metrics)) {
    const weight = Number(weights?.[metricKey] ?? 0);
    if (!weight || !metric) continue;
    weightedSum += Number(metric[field] ?? 0) * weight;
    totalWeight += weight;
  }

  if (!totalWeight) {
    return average(Object.values(metrics).map((metric) => Number(metric?.[field] ?? 0)));
  }
  return weightedSum / totalWeight;
}

function buildGoalAlignment(metrics, goalProfile) {
  const score = roundScore(weightedMetricAverage(metrics, "score", goalProfile.weights));
  const deltaFromControl = roundScore(weightedMetricAverage(metrics, "deltaFromControl", goalProfile.weights));
  const summary = goalProfile.goal
    ? deltaFromControl >= 6
      ? `Supports "${goalProfile.goal}" with emphasis on ${priorityMetricLabels(goalProfile.priorityMetrics)}.`
      : deltaFromControl <= -6
        ? `Works against "${goalProfile.goal}" because the priority metrics trail control.`
        : `Is mixed against "${goalProfile.goal}" because the priority metrics move in different directions.`
    : goalProfile.summary;

  return {
    goal: goalProfile.goal,
    summary,
    score,
    deltaFromControl,
    priorityMetrics: goalProfile.priorityMetrics,
  };
}

function buildFallbackIssues(input) {
  const metricEntries = Object.entries(input.metrics)
    .map(([metricKey, metric]) => ({
      metricKey,
      metric,
      isPriority: input.goalProfile.priorityMetrics.includes(metricKey),
    }))
    .sort((a, b) => a.metric.deltaFromControl - b.metric.deltaFromControl);

  /** @type {Array<{title:string; severity:"low"|"medium"|"high"; description:string; recommendation:string; metricKey?:string}>} */
  const issues = [];
  const seen = new Set();

  for (const entry of metricEntries) {
    if (issues.length >= 4) break;
    if (entry.metric.deltaFromControl > -2 && entry.metric.score >= 60 && !entry.isPriority) continue;
    const issue = issueFromMetric(entry.metricKey, entry.metric, entry.isPriority, input.variantAnchors, input.variantMobileAnchors);
    if (!issue || seen.has(issue.title)) continue;
    seen.add(issue.title);
    issues.push(issue);
  }

  if (!issues.length) {
    for (const entry of metricEntries.slice(0, 2)) {
      const issue = issueFromMetric(entry.metricKey, entry.metric, entry.isPriority, input.variantAnchors, input.variantMobileAnchors);
      if (!issue || seen.has(issue.title)) continue;
      seen.add(issue.title);
      issues.push(issue);
    }
  }

  return issues.slice(0, 4);
}

function issueFromMetric(metricKey, metric, isPriority, variantAnchors, variantMobileAnchors) {
  const severity = severityFromDelta(metric.deltaFromControl, isPriority);
  const ctaCount = countByKinds(variantAnchors, ["cta", "interactive"]);
  const proofCount = countByKinds(variantAnchors, ["proof"]);
  const mobileRetention = primaryAnchorRetention(variantAnchors, variantMobileAnchors);

  switch (metricKey) {
    case "messageClarity":
      return {
        title: "Offer clarity still weak",
        severity,
        description: `The visible message hierarchy is not making the value proposition faster to parse than control.${prioritySuffix(isPriority)}`,
        recommendation: "Tighten the headline and supporting copy so the offer resolves faster above the fold.",
        metricKey,
      };
    case "ctaClarity":
      return {
        title: ctaCount > 2 ? "Too many competing actions" : "Primary action lacks focus",
        severity,
        description: ctaCount > 2
          ? `The variant exposes ${ctaCount} clickable calls to action, which weakens the primary next step.${prioritySuffix(isPriority)}`
          : `The primary action is not clearly more prominent or more specific than control.${prioritySuffix(isPriority)}`,
        recommendation: "Reduce CTA ambiguity and reinforce a single primary next step near the strongest proof.",
        metricKey,
      };
    case "trustVisibility":
      return {
        title: proofCount === 0 ? "Trust cues are missing" : "Trust cues are too easy to miss",
        severity,
        description: proofCount === 0
          ? `No obvious proof or reassurance anchors were detected in the visible layout.${prioritySuffix(isPriority)}`
          : `Proof elements are present, but they are not surfacing earlier or more clearly than control.${prioritySuffix(isPriority)}`,
        recommendation: "Move proof, guarantees, or credibility cues closer to the primary decision moment.",
        metricKey,
      };
    case "distractionControl":
      return {
        title: "Competing visual pulls remain",
        severity,
        description: `The page still presents too many competing focal points around the main conversion path.${prioritySuffix(isPriority)}`,
        recommendation: "Reduce secondary visuals and actions that siphon attention from the main goal.",
        metricKey,
      };
    case "informationHierarchy":
      return {
        title: "Scan order is unstable",
        severity,
        description: `The variant does not guide the eye cleanly from message to proof to action.${prioritySuffix(isPriority)}`,
        recommendation: "Rebuild the hero stack so headline, support, proof, and CTA land in a tighter sequence.",
        metricKey,
      };
    case "personaFit":
      return {
        title: "Message does not track persona motivations",
        severity,
        description: `The visible copy and cues do not speak directly enough to this persona’s likely motivations.${prioritySuffix(isPriority)}`,
        recommendation: "Rewrite the visible framing to reflect the persona’s main motivation and likely objection.",
        metricKey,
      };
    case "frictionReduction":
      return {
        title: "Conversion friction remains high",
        severity,
        description: `The path to act still looks heavier or less direct than control.${prioritySuffix(isPriority)}`,
        recommendation: "Reduce extra form fields, optional decisions, or detours around the primary action.",
        metricKey,
      };
    case "accessibilitySafety":
      return {
        title: "Legibility or interaction safety regressed",
        severity,
        description: `The variant introduces readability or interaction risks that can suppress action.${prioritySuffix(isPriority)}`,
        recommendation: "Increase contrast, simplify dense areas, and keep critical actions easy to identify and hit.",
        metricKey,
      };
    case "mobileResilience":
      return {
        title: "Mobile hierarchy collapses",
        severity: mobileRetention < 0.55 ? bumpSeverity(severity) : severity,
        description: `Important desktop cues do not carry cleanly onto mobile in this variant.${prioritySuffix(isPriority)}`,
        recommendation: "Protect headline, proof, and CTA order on smaller screens before trusting this variant.",
        metricKey,
      };
    case "performanceSafety":
      return {
        title: "Visual weight may be too heavy",
        severity,
        description: `The variant looks denser or more visually heavy than control, which can dampen responsiveness and focus.${prioritySuffix(isPriority)}`,
        recommendation: "Trim non-essential media, decorative layers, and competing elements that do not aid conversion.",
        metricKey,
      };
    default:
      return null;
  }
}

function prioritySuffix(isPriority) {
  return isPriority ? " This matters more for the stated goal." : "";
}

function severityFromDelta(deltaFromControl, isPriority) {
  const magnitude = Math.abs(Number(deltaFromControl || 0)) + (isPriority ? 4 : 0);
  if (magnitude >= 14) return "high";
  if (magnitude >= 8) return "medium";
  return "low";
}

function bumpSeverity(severity) {
  if (severity === "low") return "medium";
  if (severity === "medium") return "high";
  return "high";
}

function buildFallbackDiff(input) {
  /** @type {Array<{title:string; type:"copy"|"hierarchy"|"cta"|"trust"|"form"|"media"|"layout"; impact:"positive"|"mixed"|"negative"; description:string}>} */
  const changes = [];
  const controlHeadline = firstAnchorLabel(input.controlAnchors, ["headline"]);
  const variantHeadline = firstAnchorLabel(input.variantAnchors, ["headline"]);
  const controlCtaY = averageKindY(input.controlAnchors, ["cta", "interactive"]);
  const variantCtaY = averageKindY(input.variantAnchors, ["cta", "interactive"]);
  const controlProofY = averageKindY(input.controlAnchors, ["proof"]);
  const variantProofY = averageKindY(input.variantAnchors, ["proof"]);
  const controlFormCount = countByKinds(input.controlAnchors, ["form"]);
  const variantFormCount = countByKinds(input.variantAnchors, ["form"]);
  const mobileRetention = primaryAnchorRetention(input.variantAnchors, input.variantMobileAnchors);

  if ((controlHeadline || variantHeadline) && (!similarLabel(controlHeadline, variantHeadline) || Math.abs(input.metrics.messageClarity.deltaFromControl) >= 4)) {
    const impact = impactFromDelta(input.metrics.messageClarity.deltaFromControl);
    changes.push(createDiffChange(
      "Hero message changed",
      "copy",
      impact,
      controlHeadline && variantHeadline && !similarLabel(controlHeadline, variantHeadline)
        ? `The hero copy appears to shift from "${controlHeadline}" toward "${variantHeadline}", changing the first impression of the offer.`
        : "The visible headline and support hierarchy changed, altering how quickly the value proposition resolves."
    ));
  }

  if (variantCtaY !== null || Math.abs(input.metrics.ctaClarity.deltaFromControl) >= 4) {
    const impact = impactFromDelta(input.metrics.ctaClarity.deltaFromControl);
    changes.push(createDiffChange(
      "CTA emphasis changed",
      "cta",
      impact,
      controlCtaY !== null && variantCtaY !== null
        ? variantCtaY < controlCtaY
          ? "The primary action appears earlier in the scan path than control."
          : "The primary action appears later or feels less isolated than control."
        : "The variant changes how prominent and isolated the primary action feels."
    ));
  }

  if (variantProofY !== null || Math.abs(input.metrics.trustVisibility.deltaFromControl) >= 4) {
    const impact = impactFromDelta(input.metrics.trustVisibility.deltaFromControl);
    changes.push(createDiffChange(
      "Trust placement shifted",
      "trust",
      impact,
      controlProofY !== null && variantProofY !== null
        ? variantProofY < controlProofY
          ? "Trust cues surface earlier in the layout than they do in control."
          : "Trust cues are pushed later or made less visible than in control."
        : "The variant changes how visible proof and reassurance are near the decision point."
    ));
  }

  if (Math.abs(input.metrics.informationHierarchy.deltaFromControl) >= 4 || Math.abs(input.metrics.distractionControl.deltaFromControl) >= 4) {
    const impact = impactFromDelta(average([
      input.metrics.informationHierarchy.deltaFromControl,
      input.metrics.distractionControl.deltaFromControl,
    ]));
    changes.push(createDiffChange(
      "Layout hierarchy shifted",
      "layout",
      impact,
      impact === "positive"
        ? "The scan path appears tighter, with less competition between headline, proof, and action."
        : impact === "negative"
          ? "The scan path appears noisier, with more competing pulls around the core message and CTA."
          : "The layout shifts emphasis across the hero stack without a clearly cleaner scan path."
    ));
  }

  if (Math.abs(input.metrics.frictionReduction.deltaFromControl) >= 4 || controlFormCount !== variantFormCount) {
    const impact = impactFromDelta(input.metrics.frictionReduction.deltaFromControl);
    changes.push(createDiffChange(
      "Action path changed",
      "form",
      impact,
      variantFormCount < controlFormCount
        ? "The variant looks lighter on forms or gated interactions than control."
        : variantFormCount > controlFormCount
          ? "The variant adds visible form or gating complexity relative to control."
          : "The variant changes how demanding the action path feels around the primary CTA."
    ));
  }

  if (Math.abs(input.metrics.mobileResilience.deltaFromControl) >= 4 || mobileRetention < 0.7) {
    const impact = impactFromDelta(input.metrics.mobileResilience.deltaFromControl);
    changes.push(createDiffChange(
      "Mobile presentation diverged",
      "hierarchy",
      impact,
      mobileRetention >= 0.75
        ? "The key desktop cues survive onto mobile with relatively little loss of structure."
        : "The desktop hierarchy does not carry cleanly to mobile, so the variant likely feels less stable on smaller screens."
    ));
  }

  if (!changes.length && input.changedFiles.length) {
    changes.push(createDiffChange(
      "Implementation touched visible UI",
      "layout",
      "mixed",
      `Changed files include ${input.changedFiles.slice(0, 3).join(", ")}, indicating visible interface adjustments even where the dominant visual shifts are subtle.`
    ));
  }

  const limitedChanges = changes.slice(0, 4);
  return {
    summary: buildDiffSummary(input.variantTitle, limitedChanges),
    likelyImpact: buildLikelyImpactFromGoal(input.metrics, input.goalProfile),
    changes: limitedChanges.length > 0
      ? limitedChanges
      : [
          createDiffChange(
            "Visible differences are subtle",
            "layout",
            "mixed",
            "The variant changes the page in smaller visual ways that do not yet amount to a clearly stronger scan path."
          ),
        ],
  };
}

function createDiffChange(title, type, impact, description) {
  return {
    title,
    type,
    impact,
    description,
  };
}

function buildDiffSummary(variantTitle, changes) {
  if (!changes.length) {
    return `${variantTitle} stays close to control, with only modest visible shifts in hierarchy and action cues.`;
  }

  const themes = [...new Set(changes.map((change) => diffTypeLabel(change.type)))].slice(0, 3);
  return `${variantTitle} changes control most through ${themes.join(", ")}, which shifts how the page is scanned and acted on.`;
}

function buildLikelyImpactFromGoal(metrics, goalProfile) {
  const primaryMetric = goalProfile.priorityMetrics[0] || "ctaClarity";
  const primaryDelta = Number(metrics?.[primaryMetric]?.deltaFromControl ?? 0);
  if (goalProfile.goal) {
    if (primaryDelta >= 6) {
      return `Most likely to help "${goalProfile.goal}" through stronger ${metricLabel(primaryMetric).toLowerCase()}.`;
    }
    if (primaryDelta <= -6) {
      return `Most likely to miss "${goalProfile.goal}" because ${metricLabel(primaryMetric).toLowerCase()} is weaker than control.`;
    }
    return `Likely to be mixed against "${goalProfile.goal}" because the priority metrics do not move in one direction.`;
  }

  return primaryDelta >= 6
    ? `Looks directionally stronger than control on its most important visible cue: ${metricLabel(primaryMetric).toLowerCase()}.`
    : primaryDelta <= -6
      ? `Looks directionally weaker than control on ${metricLabel(primaryMetric).toLowerCase()}.`
      : "Looks mixed against control, with some gains offset by weaker supporting cues.";
}

function impactFromDelta(deltaFromControl) {
  if (deltaFromControl >= 4) return "positive";
  if (deltaFromControl <= -4) return "negative";
  return "mixed";
}

function diffTypeLabel(type) {
  switch (type) {
    case "cta":
      return "CTA emphasis";
    case "trust":
      return "trust placement";
    case "form":
      return "action-path friction";
    case "media":
      return "media balance";
    case "copy":
      return "copy framing";
    case "hierarchy":
      return "mobile hierarchy";
    case "layout":
    default:
      return "layout hierarchy";
  }
}

function firstAnchorLabel(anchors, kinds) {
  return anchors.find((anchor) => kinds.includes(anchor.kind))?.label ?? "";
}

function averageKindY(anchors, kinds) {
  const matches = anchors.filter((anchor) => kinds.includes(anchor.kind)).map((anchor) => anchor.y);
  return matches.length ? average(matches) : null;
}

function countByKinds(anchors, kinds) {
  return anchors.filter((anchor) => kinds.includes(anchor.kind)).length;
}

function finalizeScorecard(raw, fallback, goalProfile) {
  /** @type {Record<string, {score:number; deltaFromControl:number; rationale:string}>} */
  const metrics = {};

  for (const [key] of SCORE_METRICS) {
    const metric = raw.metrics?.[key] ?? fallback.metrics?.[key] ?? { score: 50, deltaFromControl: 0, rationale: "" };
    metrics[key] = {
      score: roundScore(metric.score),
      deltaFromControl: roundScore(metric.deltaFromControl),
      rationale: String(metric.rationale ?? "").trim()
        || String(fallback.metrics?.[key]?.rationale ?? "").trim()
        || "Directional estimate based on the rendered comparison.",
    };
  }

  const overallScore = roundScore(average(Object.values(metrics).map((metric) => metric.score)));
  const deltaFromControl = roundScore(average(Object.values(metrics).map((metric) => metric.deltaFromControl)));
  const evidenceMix = normalizeEvidenceMix(raw.evidenceMix);
  const goalAlignment = buildGoalAlignment(metrics, goalProfile);

  return {
    summary: String(raw.summary ?? "").trim()
      || String(fallback.summary ?? "").trim()
      || "Directional synthetic scorecard generated from the rendered comparison.",
    verdict: raw.verdict === "win" || raw.verdict === "risk"
      ? raw.verdict
      : fallback.verdict === "win" || fallback.verdict === "risk"
        ? fallback.verdict
        : "mixed",
    overallScore,
    deltaFromControl,
    goalAlignment,
    confidenceLabel: raw.confidenceLabel === "high" || raw.confidenceLabel === "moderate" ? raw.confidenceLabel : "directional",
    confidenceScore: roundScore(raw.confidenceScore ?? 55),
    diffSummary: String(raw.diffSummary ?? "").trim()
      || String(fallback.diffSummary ?? "").trim()
      || "The variant changes how the page is prioritized relative to control.",
    strengths: sanitizeBulletList(raw.strengths, fallback.strengths ?? ["Improves one or more visible conversion cues versus control."]),
    risks: sanitizeBulletList(raw.risks, fallback.risks ?? ["Introduces at least one directional risk versus control."]),
    recommendations: sanitizeBulletList(
      raw.recommendations,
      fallback.recommendations ?? ["Keep iterating toward stronger clarity, hierarchy, and trust."]
    ),
    issues: sanitizeIssues(raw.issues, fallback.issues ?? []),
    diff: sanitizeDiff(raw.diff, fallback.diff),
    evidenceMix,
    metrics,
  };
}

function normalizeEvidenceMix(input) {
  const visual = Math.max(0, Number(input?.visual ?? 0));
  const structural = Math.max(0, Number(input?.structural ?? 0));
  const heuristic = Math.max(0, Number(input?.heuristic ?? 0));
  const total = visual + structural + heuristic;
  if (!total) {
    return { visual: 50, structural: 30, heuristic: 20 };
  }
  return {
    visual: roundScore((visual / total) * 100),
    structural: roundScore((structural / total) * 100),
    heuristic: roundScore((heuristic / total) * 100),
  };
}

function sanitizeBulletList(items, fallbackItems) {
  const cleaned = Array.isArray(items)
    ? items.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 4)
    : [];
  if (cleaned.length > 0) return cleaned;
  return (Array.isArray(fallbackItems) ? fallbackItems : [fallbackItems])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function sanitizeIssues(items, fallbackItems) {
  const metricKeys = new Set(SCORE_METRICS.map(([key]) => key));
  const cleaned = Array.isArray(items)
    ? items
      .map((item) => ({
        title: String(item?.title ?? "").trim(),
        severity: item?.severity === "high" || item?.severity === "medium" ? item.severity : "low",
        description: String(item?.description ?? "").trim(),
        recommendation: String(item?.recommendation ?? "").trim(),
        metricKey: metricKeys.has(item?.metricKey) ? item.metricKey : undefined,
      }))
      .filter((item) => item.title && item.description && item.recommendation)
      .slice(0, 5)
    : [];

  if (cleaned.length > 0) return cleaned;
  return Array.isArray(fallbackItems) ? fallbackItems.slice(0, 5) : [];
}

function sanitizeDiff(diff, fallbackDiff) {
  const cleanedChanges = Array.isArray(diff?.changes)
    ? diff.changes
      .map((change) => sanitizeDiffChange(change))
      .filter(Boolean)
      .slice(0, 5)
    : [];

  return {
    summary: String(diff?.summary ?? "").trim() || String(fallbackDiff?.summary ?? "").trim() || "Visible changes versus control are modest and mixed.",
    likelyImpact: String(diff?.likelyImpact ?? "").trim()
      || String(fallbackDiff?.likelyImpact ?? "").trim()
      || "Likely to be mixed until the strongest visible differences are sharpened.",
    changes: cleanedChanges.length > 0
      ? cleanedChanges
      : Array.isArray(fallbackDiff?.changes)
        ? fallbackDiff.changes.slice(0, 5)
        : [],
  };
}

function sanitizeDiffChange(change) {
  if (!change) return null;
  const title = String(change.title ?? "").trim();
  const description = String(change.description ?? "").trim();
  if (!title || !description) return null;
  return {
    title,
    type: ["copy", "hierarchy", "cta", "trust", "form", "media", "layout"].includes(change.type) ? change.type : "layout",
    impact: change.impact === "positive" || change.impact === "negative" ? change.impact : "mixed",
    description,
  };
}

function summarizeAnchors(anchors) {
  if (!anchors.length) return ["- none"];
  return anchors.slice(0, 10).map(
    (anchor) =>
      `- ${anchor.kind} [${anchor.priority}] "${anchor.label}" at (${anchor.x.toFixed(2)}, ${anchor.y.toFixed(2)}) size ${anchor.width.toFixed(2)}x${anchor.height.toFixed(2)}`
  );
}

function summarizeFocusSignals(anchors, boxes) {
  const scored = summarizeFocusScores(anchors, boxes).slice(0, 6);
  if (!scored.length) return ["- no clear hotspots recorded"];
  return scored.map(
    ({ anchor, focus }) => `- ${anchor.kind} "${anchor.label}" focus=${focus.toFixed(2)}`
  );
}

function summarizeFocusScores(anchors, boxes) {
  return anchors
    .map((anchor) => ({
      anchor,
      focus: boxes.reduce((sum, box) => sum + box.weight * overlapRatio(anchor, box), 0),
    }))
    .filter((entry) => entry.focus > 0.02)
    .sort((a, b) => b.focus - a.focus);
}

function overlapRatio(anchor, box) {
  const left = Math.max(anchor.x, box.x);
  const top = Math.max(anchor.y, box.y);
  const right = Math.min(anchor.x + anchor.width, box.x + box.width);
  const bottom = Math.min(anchor.y + anchor.height, box.y + box.height);
  const overlapWidth = Math.max(0, right - left);
  const overlapHeight = Math.max(0, bottom - top);
  const intersection = overlapWidth * overlapHeight;
  if (!intersection) return 0;
  const anchorArea = anchor.width * anchor.height;
  return anchorArea > 0 ? intersection / anchorArea : 0;
}

function sanitizeBoxes(boxes) {
  return boxes.map((box) => ({
    x: clamp01(box.x),
    y: clamp01(box.y),
    width: clampRange(box.width, 0.01, 1),
    height: clampRange(box.height, 0.01, 1),
    weight: clamp01(box.weight),
  }));
}

function similarLabel(a, b) {
  const left = String(a ?? "").toLowerCase().trim();
  const right = String(b ?? "").toLowerCase().trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function roundScore(value) {
  return Math.round(clampRange(Number(value) || 0, -100, 100));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function signed(value) {
  const rounded = roundScore(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/**
 * @param {string} input
 */
function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}
