import { ReasoningPolicy } from "./types";
import { isWebFirstRequiredModel } from "../models/model-identification";

/**
 * Resolves the operational reasoning policy for a given model or combo.
 * Exact matching: 'exploit' & 'health-ai' => DISABLED, all other combos/models => AUTO.
 */
export function resolveReasoningPolicy(modelId: string): ReasoningPolicy {
  if (isWebFirstRequiredModel(modelId)) {
    return "DISABLED";
  }

  return "AUTO";
}
