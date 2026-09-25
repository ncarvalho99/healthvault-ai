/**
 * Model Identification & Policy Scoping
 *
 * Centralizes exact identification for special inference models (health-ai, exploit)
 * avoiding substring collisions (e.g. models whose names merely contain substrings).
 */

const EXACT_HEALTH_AI_MODELS = new Set(["health-ai"]);
const EXACT_EXPLOIT_MODELS = new Set(["exploit"]);

/**
 * Checks if the modelId corresponds exactly to the specialized health-ai combo.
 */
export function isHealthAiModel(modelId?: string | null): boolean {
  if (!modelId) return false;
  const normalized = modelId.trim().toLowerCase();
  return EXACT_HEALTH_AI_MODELS.has(normalized);
}

/**
 * Checks if the modelId corresponds exactly to the exploit combo.
 */
export function isExploitModel(modelId?: string | null): boolean {
  if (!modelId) return false;
  const normalized = modelId.trim().toLowerCase();
  return EXACT_EXPLOIT_MODELS.has(normalized);
}

/**
 * Checks if the model operates under mandatory Web-First Research (REQUIRED).
 */
export function isWebFirstRequiredModel(modelId?: string | null): boolean {
  return isHealthAiModel(modelId) || isExploitModel(modelId);
}
