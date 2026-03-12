<h1 align="center">mutatr</h1>

<p align="center">
  <strong>Autonomous A/B testing agent for small teams and indie builders.</strong><br/>
  Suggest tests. Implement variants. Simulate attention. Ship winners.
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-37-47848F?logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" />
  <img alt="Claude" src="https://img.shields.io/badge/Claude_Agent_SDK-0.2-cc785c?logo=anthropic&logoColor=white" />
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-1.53-2EAD33?logo=playwright&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue" />
</p>

---

## What is mutatr?

Traditional A/B testing tools are built for enterprises with dedicated growth teams and high traffic. Mutatr brings that capability to everyone else.

Mutatr is an **Electron desktop app** that uses the **Claude Agent SDK** to autonomously suggest, implement, and evaluate website experiments — and **Playwright** to render variants and produce attention heatmaps. When real traffic is low, it simulates visitors using synthetic customer personas so you can get directional signal before going live.

This repository currently packages and distributes **macOS desktop builds** only.

### How it works

```
1. Point mutatr at your project folder
2. It discovers your pages and generates synthetic personas
3. Pick a page → mutatr suggests high-impact tests
4. Approve tests → mutatr implements the code changes autonomously
5. Select personas → mutatr simulates multi-visitor attention per variant
6. Compare control vs. variant heatmaps with an interactive slider
```

## Features

### AI-Powered Test Suggestions
Claude analyzes your page source and personas to propose conversion-focused A/B tests with hypotheses, expected impact, and risk levels.

### Autonomous Variant Implementation
Approved tests are implemented by Claude in an isolated temp copy of your project. Variants are rendered from that copy, and only sanitized repo-relative files can be written back when you explicitly push a PR.

### Synthetic Persona Engine
AI-generated customer personas (demographics, motivations, pain points, tone) that drive realistic attention simulations when real traffic isn't available.

### Multi-Visitor Attention Heatmaps
Configurable visitor count per variant/persona pair. Multiple LLM calls run **in parallel**, and results are merged into Clarity-style heatmaps (blue → green → yellow → red) overlaid on full-page screenshots.

### Control vs. Variant Comparison
Interactive slider UI: control heatmap on the left, variant on the right. Switch between variants and personas to compare attention patterns.

### Per-Model Configuration
Choose different Claude models (Sonnet, Opus, Haiku) for each stage — persona generation, test suggestions, implementation, and attention analysis.

## Screenshots

| Workflow | Heatmap Comparison |
|---|---|
| Choose page → Treatments → Renders → Personas → Results | Control vs. variant slider with persona sidebar |

## Getting Started

### Prerequisites

- **Node.js 18+**
- One of:
  - A valid [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) local auth context
  - An Anthropic API key (entered in Settings)

### Install

```bash
git clone https://github.com/novynlabs/mutatr.git
cd mutatr
npm install
```

Imported projects should already have their own dependencies installed. Mutatr will not run `npm install` for them automatically.

### Run

```bash
npm run dev
```

This starts Vite (renderer) + Electron (main process) concurrently. The app window opens automatically.

### Build

```bash
npm run build
```

This builds the renderer only.

### Package The macOS App

```bash
npm run package
```

Create distributable macOS artifacts:

```bash
npm run dist
```

`npm run package` and `npm run dist` are macOS-only release commands.

## Usage

1. **Add a project** — Click "New project" and select your web project folder. Mutatr discovers pages, starts a local dev server if it can, and renders thumbnails.

2. **Create an experiment** — Give it a name, then choose a target page.

3. **Generate tests** — Click "Suggest tests" to get AI-generated A/B test ideas with hypotheses and risk levels.

4. **Implement variants** — Select tests and click "Implement selected". Claude writes the code changes in an isolated temp copy; Playwright screenshots that rendered variant.

5. **Run attention analysis** — Select renders and personas, set visitor count, and click "Run test". Mutatr produces heatmaps for every (variant, persona) pair plus controls.

6. **Compare results** — Use the slider to compare control vs. variant attention, then review per-persona scorecards, issue detection, diff explanations, and aggregate variant scores.

## Architecture

```
mutatr/
├── electron/                  # Main process
│   ├── main.mjs               # IPC handlers, app lifecycle
│   ├── preload.cjs            # Context bridge
│   └── services/
│       ├── claudeService.mjs  # Claude Agent SDK calls
│       ├── playwrightService.mjs  # Page rendering, heatmap generation
│       ├── projectService.mjs # Project discovery, dev server detection
│       └── store.mjs          # JSON persistence
├── src/                       # Renderer (React)
│   ├── App.tsx                # Main UI — workflow, comparison slider, settings
│   ├── main.tsx               # Entry point with browser-dev mock API
│   ├── components/ui/         # Radix UI primitives (dialog, tabs, button, etc.)
│   ├── types/contracts.ts     # Shared TypeScript contracts
│   └── styles/app.css         # Custom styles (Tailwind + OKLCH theme)
├── e2e/                       # End-to-end tests
│   ├── run-e2e.mjs            # Mock Claude E2E
│   └── run-live-e2e.mjs       # Real Claude API E2E
└── public/                    # Static assets
```

### Key Design Decisions

- **Isolated variant rendering** — Each test variant is implemented and rendered from its own temp copy. The original repo is not mutated during screenshot capture.
- **Strict file-path boundary** — Model-reported changed files are normalized against the project root, and unsafe paths are rejected before rendering or PR creation.
- **Parallel visitor queries** — All visitor LLM calls within an attention run fire concurrently via `Promise.all`.
- **No automatic dependency installs** — Imported projects must already be runnable; if a dev server cannot boot, mutatr renders a clear fallback tile instead of modifying the project.
- **macOS distribution path** — Electron Builder is configured for signed DMG + ZIP artifacts with hardened runtime entitlements and notarization-ready environment variables.
- **Canvas-based heatmaps** — Intensity map with additive blending → colormap, producing smooth full-coverage Clarity-style heatmaps.

## Testing

### Mock E2E (no API key needed)

```bash
npm run test:e2e
```

Runs a full Electron E2E test with mocked Claude responses. Validates:
- Project add/open/remove
- Full experiment workflow (choose page → goal → treatments → renders → personas → results)
- Aggregate scorecard, issue detector, and diff explainer UI
- Persona generation and custom persona creation
- Settings save/clear and key-storage mode handling

### Live E2E (real Claude API)

```bash
E2E_CLAUDE_API_KEY=sk-ant-... npm run test:e2e:live
```

Uses a real Claude API key to validate non-mock outputs against a multi-route fixture app.

## Configuration

Open **Settings** from the sidebar to configure:

| Setting | Description |
|---|---|
| Claude API Key | Anthropic API key (or leave empty for SDK local auth) |
| Personas model | Model for synthetic persona generation |
| Suggestions model | Model for test idea generation |
| Implementation model | Model for autonomous code changes |
| Attention model | Model for attention simulation |

Each can be set to **Default (inherit)**, **Sonnet**, **Opus**, or **Haiku**.

## macOS Distribution

### Local mac builds

`npm run package` and `npm run dist` now choose between two signing modes automatically:

- If a `Developer ID Application` identity or `CSC_*` signing environment is available, Electron Builder uses it.
- Otherwise the build falls back to **ad-hoc signing** so the generated `.app` still launches correctly on the local machine instead of picking an arbitrary non-Apple certificate.

For public distribution, configure notarization and Developer ID signing.

### Local notarized builds

Create an `electron-builder.env` file from [electron-builder.env.example](/Users/ahmedashraf/Desktop/mutatr/electron-builder.env.example) and set:

- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_TEAM_ID` (recommended)

For CI or machines without the signing cert in Keychain, also set:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

Then run:

```bash
npm run dist
```

The release output lands in `release/` and includes a `SHA256SUMS.txt` manifest.

### GitHub Actions release job

The repo includes a mac-only workflow at [.github/workflows/release-mac.yml](/Users/ahmedashraf/Desktop/mutatr/.github/workflows/release-mac.yml). On `v*` tags it:

- validates the required signing/notarization secrets
- builds signed DMG + ZIP artifacts
- uploads them as workflow artifacts
- attaches them to the GitHub release

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Vite + Electron in development mode |
| `npm run dev:renderer` | Start Vite dev server only (for browser-only dev) |
| `npm run build` | Build the renderer for production |
| `npm run package` | Build the renderer and create an unpacked macOS app bundle with automatic Developer ID vs ad-hoc signing selection |
| `npm run dist` | Build macOS release artifacts and checksums with automatic Developer ID vs ad-hoc signing selection |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run test:e2e` | Run E2E tests with mock Claude |
| `npm run test:e2e:live` | Run E2E tests with real Claude API |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 37 (macOS distribution) |
| Frontend | React 19, TypeScript 5.9, Tailwind CSS 3 |
| Build | Vite 7 |
| AI | Claude Agent SDK ([@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)) |
| Browser automation | Playwright 1.53 |
| UI primitives | Radix UI (Dialog, Tabs, Checkbox) |
| Icons | Lucide React |

## Data Storage

All state is stored locally in Electron's user data directory under `mutatr-app/`:
- `state.json` — projects, experiments, personas, settings metadata
- `claudeApiKeyEncrypted` inside `state.json` when secure OS storage is available; otherwise the key stays in memory for the current session only
- `images/` — rendered screenshots and heatmap PNGs

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a pull request

## License

[MIT](LICENSE)

---

<p align="center">
  Built by <a href="https://github.com/novynlabs">Novyn Labs</a>
</p>
