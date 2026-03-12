export const DEFAULT_MODELS = {
  suggestionModel: "claude-sonnet-4-20250514",
  implementationModel: "claude-sonnet-4-20250514",
  personasModel: "claude-sonnet-4-20250514",
  attentionModel: "claude-sonnet-4-20250514",
};

/**
 * @param {unknown} value
 */
export function normalizeModel(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "inherit" || trimmed.toLowerCase() === "default") {
    return undefined;
  }
  return trimmed;
}
