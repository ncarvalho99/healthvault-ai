/**
 * Web Research Provider Priority Resolution
 *
 * Single central resolver for Web Research provider priority and execution chain.
 * Reads WEB_RESEARCH_PROVIDER_PRIORITY, validates against allowlist,
 * deduplicates, removes unknown engines, and groups consecutive OmniRoute
 * subproviders without altering the relative execution order with direct fallbacks.
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

export type ChainSegment =
  | { type: "omniroute"; subProviders: string[] }
  | { type: "searxng" }
  | { type: "brave" };

export interface EffectiveResearchPriority {
  fullPriority: string[];
  omnirouteSubProviders: string[];
  directFallbacks: string[];
  primaryProvider: string;
  chainSegments: ChainSegment[];
  chainDescription: string[];
}

/**
 * Builds consecutive chain segments preserving relative order.
 * Consecutive OmniRoute subproviders are grouped into a single segment.
 */
export function buildChainSegments(fullPriority: string[]): ChainSegment[] {
  const segments: ChainSegment[] = [];

  for (const provider of fullPriority) {
    if (OMNIROUTE_SUBPROVIDERS.has(provider)) {
      const last = segments[segments.length - 1];
      if (last && last.type === "omniroute") {
        last.subProviders.push(provider);
      } else {
        segments.push({
          type: "omniroute",
          subProviders: [provider],
        });
      }
    } else if (provider === "searxng") {
      segments.push({ type: "searxng" });
    } else if (provider === "brave") {
      segments.push({ type: "brave" });
    }
  }

  return segments;
}

/**
 * Formats user-readable descriptions for chain segments:
 * e.g. "OmniRoute(firecrawl → ollama-search)", "SearXNG", "Brave"
 */
export function formatChainDescription(segments: ChainSegment[]): string[] {
  return segments.map((seg) => {
    if (seg.type === "omniroute") {
      return seg.subProviders.length > 1
        ? `OmniRoute(${seg.subProviders.join(" → ")})`
        : `OmniRoute(${seg.subProviders[0]})`;
    }
    if (seg.type === "searxng") {
      return "SearXNG";
    }
    if (seg.type === "brave") {
      return "Brave";
    }
    return String((seg as any).type);
  });
}

/**
 * Resolves the effective provider priority and execution chain.
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

  // Fallback to safe default ONLY if empty or all tokens were unknown
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

  const chainSegments = buildChainSegments(validatedPriority);
  const chainDescription = formatChainDescription(chainSegments);

  return {
    fullPriority: validatedPriority,
    omnirouteSubProviders,
    directFallbacks,
    primaryProvider: validatedPriority[0] || "firecrawl",
    chainSegments,
    chainDescription,
  };
}
