/**
 * @typedef {{
 * id: string;
 * route: string;
 * filePath: string;
 * thumbnailDataUrl?: string;
 * screenshotPath?: string;
 * mobileScreenshotDataUrl?: string;
 * mobileScreenshotPath?: string;
 * personaSnapshot?: string;
 * attentionAnchors?: AttentionAnchor[];
 * mobileAttentionAnchors?: AttentionAnchor[];
 * }} PageRecord
 */

/**
 * @typedef {{
 * id: string;
 * kind: 'headline' | 'cta' | 'interactive' | 'form' | 'media' | 'proof' | 'copy';
 * label: string;
 * tagName: string;
 * role: string;
 * x: number;
 * y: number;
 * width: number;
 * height: number;
 * priority: number;
 * }} AttentionAnchor
 */

/**
 * @typedef {{
 * id: string;
 * title: string;
 * hypothesis: string;
 * expectedImpact: string;
 * implementationPrompt: string;
 * riskLevel: 'low' | 'medium' | 'high';
 * }} TestSuggestion
 */

/**
 * @typedef {{
 * id: string;
 * name: string;
 * summary: string;
 * ageBand: string;
 * motivations: string[];
 * painPoints: string[];
 * tone: string;
 * preferredChannels: string[];
 * }} PersonaRecord
 */

/**
 * @typedef {{
 * id: string;
 * testId: string;
 * title: string;
 * route: string;
 * screenshotDataUrl?: string;
 * screenshotPath?: string;
 * mobileScreenshotDataUrl?: string;
 * mobileScreenshotPath?: string;
 * changedFiles?: string[];
 * changedFileContents?: Record<string, string|null>;
 * attentionAnchors?: AttentionAnchor[];
 * mobileAttentionAnchors?: AttentionAnchor[];
 * errorMessage?: string;
 * }} RenderRecord
 */

/**
 * @typedef {'messageClarity' | 'ctaClarity' | 'trustVisibility' | 'distractionControl' | 'informationHierarchy' | 'personaFit' | 'frictionReduction' | 'accessibilitySafety' | 'mobileResilience' | 'performanceSafety'} ScoreMetricKey
 */

/**
 * @typedef {{
 * score: number;
 * deltaFromControl: number;
 * rationale: string;
 * }} ScoreMetric
 */

/**
 * @typedef {{
 * score: number;
 * deltaFromControl: number;
 * spread: number;
 * }} ScoreMetricSummary
 */

/**
 * @typedef {{
 * visual: number;
 * structural: number;
 * heuristic: number;
 * }} EvidenceMix
 */

/**
 * @typedef {{
 * goal: string | null;
 * summary: string;
 * score: number;
 * deltaFromControl: number;
 * priorityMetrics: ScoreMetricKey[];
 * }} GoalAlignment
 */

/**
 * @typedef {{
 * title: string;
 * severity: 'low' | 'medium' | 'high';
 * description: string;
 * recommendation: string;
 * metricKey?: ScoreMetricKey;
 * }} ScoreIssue
 */

/**
 * @typedef {{
 * title: string;
 * type: 'copy' | 'hierarchy' | 'cta' | 'trust' | 'form' | 'media' | 'layout';
 * impact: 'positive' | 'mixed' | 'negative';
 * description: string;
 * }} DiffChange
 */

/**
 * @typedef {{
 * summary: string;
 * likelyImpact: string;
 * changes: DiffChange[];
 * }} VariantDiffExplanation
 */

/**
 * @typedef {{
 * summary: string;
 * verdict: 'win' | 'mixed' | 'risk';
 * overallScore: number;
 * deltaFromControl: number;
 * goalAlignment: GoalAlignment;
 * confidenceLabel: 'directional' | 'moderate' | 'high';
 * confidenceScore: number;
 * diffSummary: string;
 * strengths: string[];
 * risks: string[];
 * recommendations: string[];
 * issues: ScoreIssue[];
 * diff: VariantDiffExplanation;
 * evidenceMix: EvidenceMix;
 * metrics: Record<ScoreMetricKey, ScoreMetric>;
 * }} VariantPersonaScorecard
 */

/**
 * @typedef {{
 * summary: string;
 * overallScore: number;
 * averageDeltaFromControl: number;
 * goalAlignment: GoalAlignment;
 * consistencyScore: number;
 * bestPersonaId: string | null;
 * weakestPersonaId: string | null;
 * strengths: string[];
 * risks: string[];
 * recommendations: string[];
 * issues: ScoreIssue[];
 * diff: VariantDiffExplanation;
 * metrics: Record<ScoreMetricKey, ScoreMetricSummary>;
 * }} VariantAggregateScorecard
 */

/**
 * @typedef {{
 * id: string;
 * name: string;
 * pageId: string | null;
 * goal: string | null;
 * createdAt: string;
 * tests: TestSuggestion[];
 * renders: RenderRecord[];
 * attention: { heatmaps: Record<string, { scorecard?: VariantPersonaScorecard }>, controlHeatmaps: Record<string, object>, variantSummaries: Record<string, VariantAggregateScorecard> } | null;
 * }} ExperimentRecord
 */

export {};
