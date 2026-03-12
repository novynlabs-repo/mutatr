export type ApiResult<T> =
  | {
      ok: true;
      payload: T;
    }
  | {
      ok: false;
      error: string;
    };

export type PageRecord = {
  id: string;
  route: string;
  filePath: string;
  thumbnailDataUrl?: string;
  screenshotPath?: string;
  mobileScreenshotDataUrl?: string;
  mobileScreenshotPath?: string;
  personaSnapshot?: string;
  attentionAnchors?: AttentionAnchor[];
  mobileAttentionAnchors?: AttentionAnchor[];
};

export type AttentionAnchor = {
  id: string;
  kind: "headline" | "cta" | "interactive" | "form" | "media" | "proof" | "copy";
  label: string;
  tagName: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
};

export type PersonaRecord = {
  id: string;
  name: string;
  summary: string;
  ageBand: string;
  motivations: string[];
  painPoints: string[];
  tone: string;
  preferredChannels: string[];
};

export type TestSuggestion = {
  id: string;
  title: string;
  hypothesis: string;
  expectedImpact: string;
  implementationPrompt: string;
  riskLevel: "low" | "medium" | "high";
};

export type RenderRecord = {
  id: string;
  testId: string;
  title: string;
  route: string;
  screenshotDataUrl?: string;
  screenshotPath?: string;
  mobileScreenshotDataUrl?: string;
  mobileScreenshotPath?: string;
  changedFiles?: string[];
  changedFileContents?: Record<string, string | null>;
  attentionAnchors?: AttentionAnchor[];
  mobileAttentionAnchors?: AttentionAnchor[];
};

export type ScoreMetricKey =
  | "messageClarity"
  | "ctaClarity"
  | "trustVisibility"
  | "distractionControl"
  | "informationHierarchy"
  | "personaFit"
  | "frictionReduction"
  | "accessibilitySafety"
  | "mobileResilience"
  | "performanceSafety";

export type ScoreMetric = {
  score: number;
  deltaFromControl: number;
  rationale: string;
};

export type ScoreMetricSummary = {
  score: number;
  deltaFromControl: number;
  spread: number;
};

export type EvidenceMix = {
  visual: number;
  structural: number;
  heuristic: number;
};

export type GoalAlignment = {
  goal: string | null;
  summary: string;
  score: number;
  deltaFromControl: number;
  priorityMetrics: ScoreMetricKey[];
};

export type ScoreIssue = {
  title: string;
  severity: "low" | "medium" | "high";
  description: string;
  recommendation: string;
  metricKey?: ScoreMetricKey;
};

export type DiffChange = {
  title: string;
  type: "copy" | "hierarchy" | "cta" | "trust" | "form" | "media" | "layout";
  impact: "positive" | "mixed" | "negative";
  description: string;
};

export type VariantDiffExplanation = {
  summary: string;
  likelyImpact: string;
  changes: DiffChange[];
};

export type VariantPersonaScorecard = {
  summary: string;
  verdict: "win" | "mixed" | "risk";
  overallScore: number;
  deltaFromControl: number;
  goalAlignment: GoalAlignment;
  confidenceLabel: "directional" | "moderate" | "high";
  confidenceScore: number;
  diffSummary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  issues: ScoreIssue[];
  diff: VariantDiffExplanation;
  evidenceMix: EvidenceMix;
  metrics: Record<ScoreMetricKey, ScoreMetric>;
};

export type VariantAggregateScorecard = {
  summary: string;
  overallScore: number;
  averageDeltaFromControl: number;
  goalAlignment: GoalAlignment;
  consistencyScore: number;
  bestPersonaId: string | null;
  weakestPersonaId: string | null;
  strengths: string[];
  risks: string[];
  recommendations: string[];
  issues: ScoreIssue[];
  diff: VariantDiffExplanation;
  metrics: Record<ScoreMetricKey, ScoreMetricSummary>;
};

export type ExperimentRecord = {
  id: string;
  name: string;
  pageId: string | null;
  goal: string | null;
  createdAt: string;
  tests: TestSuggestion[];
  renders: RenderRecord[];
  attention: AttentionResult | null;
};

export type ProjectRecord = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  pages: PageRecord[];
  personas: PersonaRecord[];
  experiments: ExperimentRecord[];
  lastUpdatedAt: string;
  status: "importing" | "ready";
};

export type AttentionPayload = {
  rationale: string;
  boxes: { x: number; y: number; width: number; height: number; weight: number }[];
  heatmapDataUrl: string;
  scorecard?: VariantPersonaScorecard;
};

export type AttentionResult = {
  heatmaps: Record<string, AttentionPayload>;       // key = "${renderId}__${personaId}"
  controlHeatmaps: Record<string, AttentionPayload>; // key = personaId
  variantSummaries: Record<string, VariantAggregateScorecard>;
};

export type AppSettings = {
  hasClaudeApiKey: boolean;
  maskedClaudeApiKey: string;
  apiKeyStorage: "none" | "env" | "plaintext";
  suggestionModel: string;
  implementationModel: string;
  personasModel: string;
  attentionModel: string;
};

export type ProgressLine = {
  id: string;
  label: string;
  status: "running" | "done" | "error";
  tokens: string;
  group?: string;
};

export type ProgressEvent = {
  lineId: string;
  label: string;
  status: "running" | "done" | "error";
  tokenDelta: string;
  group?: string;
};

export type MutatrApi = {
  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onProjectUpdated(callback: (project: ProjectRecord) => void): () => void;
  getSettings(): Promise<ApiResult<AppSettings>>;
  updateSettings(payload: {
    claudeApiKey?: string;
    suggestionModel?: string;
    implementationModel?: string;
    personasModel?: string;
    attentionModel?: string;
  }): Promise<ApiResult<AppSettings>>;

  listProjects(): Promise<ApiResult<ProjectRecord[]>>;
  addProject(selectedPath?: string): Promise<ApiResult<ProjectRecord>>;
  removeProject(projectId: string): Promise<ApiResult<boolean>>;
  refreshPages(projectId: string): Promise<ApiResult<ProjectRecord>>;

  refreshPersonas(projectId: string): Promise<ApiResult<PersonaRecord[]>>;
  addPersona(
    projectId: string,
    payload: {
      name: string;
      summary: string;
      ageBand?: string;
      motivations?: string[];
      painPoints?: string[];
      tone?: string;
      preferredChannels?: string[];
    }
  ): Promise<ApiResult<PersonaRecord[]>>;

  createExperiment(projectId: string, name: string): Promise<ApiResult<ProjectRecord>>;
  deleteExperiment(projectId: string, experimentId: string): Promise<ApiResult<ProjectRecord>>;
  setExperimentPage(projectId: string, experimentId: string, pageId: string): Promise<ApiResult<ProjectRecord>>;
  setExperimentGoal(projectId: string, experimentId: string, goal: string | null): Promise<ApiResult<ProjectRecord>>;

  suggestTests(projectId: string, experimentId: string): Promise<ApiResult<TestSuggestion[]>>;
  implementTests(
    projectId: string,
    experimentId: string,
    selectedTestIds: string[]
  ): Promise<ApiResult<RenderRecord[]>>;
  runAttention(
    projectId: string,
    experimentId: string,
    renderIds: string[],
    personaIds: string[],
    visitors: number
  ): Promise<ApiResult<AttentionResult>>;
  pushRenderAsPR(
    projectId: string,
    experimentId: string,
    renderId: string
  ): Promise<ApiResult<{ prUrl: string }>>;
};
