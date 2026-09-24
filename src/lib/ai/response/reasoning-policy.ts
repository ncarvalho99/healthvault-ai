import { ReasoningPolicy } from "./types";

/**
 * Resolves the operational reasoning policy for a given model or combo.
 * Default initial policy: 'exploit' => DISABLED, all other combos/models => AUTO.
 */
export function resolveReasoningPolicy(modelId: string): ReasoningPolicy {
  if (!modelId) return "AUTO";
  const normalized = modelId.trim().toLowerCase();

  if (normalized === "exploit" || normalized.includes("exploit")) {
    return "DISABLED";
  }

  return "AUTO";
}
