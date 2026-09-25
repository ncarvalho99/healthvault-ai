import { ResearchPolicy } from "./types";
import { isWebFirstRequiredModel } from "../models/model-identification";

/**
 * Resolves the operational Web Research Policy for a given model or combo.
 *
 * Architecture rule:
 * - 'health-ai' & 'exploit' => REQUIRED (web preflight is mandatory for external factual questions)
 * - other combos/models => AUTO (researches only when explicit external or current clinical information is sought)
 *
 * Exact model matching via isWebFirstRequiredModel (no loose includes substring checks).
 */
export function resolveResearchPolicy(
  modelId: string,
  userOverride?: ResearchPolicy
): ResearchPolicy {
  if (userOverride && ["AUTO", "REQUIRED", "OFF"].includes(userOverride)) {
    return userOverride;
  }

  if (isWebFirstRequiredModel(modelId)) {
    return "REQUIRED";
  }

  return "AUTO";
}
