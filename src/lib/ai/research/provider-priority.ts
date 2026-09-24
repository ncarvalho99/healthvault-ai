/**
 * Web Research Provider Priority Resolution
 *
 * Single central resolver for Web Research provider priority.
 * Reads WEB_RESEARCH_PROVIDER_PRIORITY, validates against allowlist,
 * deduplicates, removes unknown engines, and separates OmniRoute subproviders
 * from direct fallbacks (such as local SearXNG).
 */

export const DEFAULT_RESEARCH_PRIORITY = [
  "firecrawl",
  "ollama-search",
  "searxng",
] as const;

export const OMNIROUTE_SUBPROVIDERS = new Set([
  "firecrawl",
  "ollama-search",
  "serper-search",
  "brave-search",
  "tavily-search",
  "exa-search",
  "perplexity-search",
  "google-pse-search",
  "linkup-search",
  "searchapi-search",
  "youcom-search",
  "zai-search",
  "jina-search",
  "duckduckgo-free",
  "x-search",
]);

export const DIRECT_FALLBACK_PROVIDERS = new Set([
  "searxng",
  "brave",
]);

export const ALLOWED_RESEARCH_PROVIDERS = new Set([
  ...OMNIROUTE_SUBPROVIDERS,
  ...DIRECT_FALLBACK_PROVIDERS,
]);

export interface EffectiveResearchPriority {
  fullPriority: string[];
  omnirouteSubProviders: string[];
  directFallbacks: string[];
  primaryProvider: string;
}

/**
 * Resolves the effective provider priority.
 * Accepts an optional string to facilitate deterministic testing or dynamic overrides.
 */
export function resolveResearchProviderPriority(
  rawInput?: string
): EffectiveResearchPriority {
  const envVal =
    rawInput !== undefined
      ? rawInput
      : typeof process !== "undefined" && process.env
      ? process.env.WEB_RESEARCH_PROVIDER_PRIORITY
      : undefined;

  let validatedPriority: string[] = [];

  if (typeof envVal === "string" && envVal.trim().length > 0) {
    const rawTokens = envVal
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    const seen = new Set<string>();
    for (const token of rawTokens) {
      if (ALLOWED_RESEARCH_PROVIDERS.has(token) && !seen.has(token)) {
        seen.add(token);
        validatedPriority.push(token);
      }
    }
  }

  // Fallback to safe default if empty or all tokens were unknown
  if (validatedPriority.length === 0) {
    validatedPriority = [...DEFAULT_RESEARCH_PRIORITY];
  }

  const omnirouteSubProviders: string[] = [];
  const directFallbacks: string[] = [];

  for (const p of validatedPriority) {
    if (OMNIROUTE_SUBPROVIDERS.has(p)) {
      omnirouteSubProviders.push(p);
    } else if (DIRECT_FALLBACK_PROVIDERS.has(p)) {
      directFallbacks.push(p);
    }
  }

  // Ensure OmniRoute subproviders has at least firecrawl as safety default if none present
  if (omnirouteSubProviders.length === 0) {
    omnirouteSubProviders.push("firecrawl");
  }

  return {
    fullPriority: validatedPriority,
    omnirouteSubProviders,
    directFallbacks,
    primaryProvider: validatedPriority[0] || "firecrawl",
  };
}
