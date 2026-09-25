import { ResearchPolicy } from "./types";

/**
 * Resolves the operational Web Research Policy for a given model or combo.
 *
 * Architecture rule:
 * - 'exploit' => REQUIRED (model knowledge base may be stale or untrusted for external facts; web preflight is mandatory)
 * - other combos/models => AUTO (researches only when explicit external or current clinical information is sought)
 *
 * Never spread `if (model === "exploit")` across codebase.
 */
export function resolveResearchPolicy(
  modelId: string,
  userOverride?: ResearchPolicy
): ResearchPolicy {
  if (userOverride && ["AUTO", "REQUIRED", "OFF"].includes(userOverride)) {
    return userOverride;
  }

  if (!modelId) return "AUTO";
  const normalized = modelId.trim().toLowerCase();

  if (
    normalized === "exploit" ||
    normalized.includes("exploit") ||
    normalized === "health-ai" ||
    normalized.includes("health-ai")
  ) {
    return "REQUIRED";
  }

  return "AUTO";
}
