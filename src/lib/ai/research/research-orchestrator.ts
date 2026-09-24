import crypto from "node:crypto";
import {
  ResearchExecutionResult,
  ResearchPolicy,
  SearchResult,
  WebResearchProvider,
} from "./types";
import { resolveResearchPolicy } from "./research-policy";
import { ResearchIntentAnalyzer } from "./research-intent";
import { SourceRanking } from "./source-ranking";
import { ResearchCache } from "./research-cache";
import { ResearchContextBuilder } from "./research-context-builder";
import { SearXNGProvider } from "./providers/searxng-provider";
import { BraveSearchProvider } from "./providers/brave-provider";

export class ResearchOrchestrator {
  /**
   * Instantiates the configured WebResearchProvider.
   */
  static getProvider(customProviderName?: string): WebResearchProvider | null {
    const providerType = (
      customProviderName ||
      process.env.WEB_RESEARCH_PROVIDER ||
      "searxng"
    ).trim().toLowerCase();

    if (providerType === "searxng") {
      return new SearXNGProvider();
    } else if (providerType === "brave") {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) return null;
      return new BraveSearchProvider();
    }

    return new SearXNGProvider();
  }

  /**
   * Orchestrates the complete Web-First Research pipeline.
   */
  static async execute(params: {
    userMessage: string;
    modelId: string;
    agentMode?: string;
    policyOverride?: ResearchPolicy;
    providerOverride?: string;
  }): Promise<ResearchExecutionResult> {
    const runId = "res_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const start = performance.now();

    const policy = resolveResearchPolicy(params.modelId, params.policyOverride);
    const intentAnalysis = ResearchIntentAnalyzer.analyze(params.userMessage, params.agentMode);
    const queryHash = crypto
      .createHash("sha256")
      .update(params.userMessage.trim().toLowerCase())
      .digest("hex")
      .slice(0, 16);

    // 1. If policy is OFF, skip immediately
    if (policy === "OFF") {
      return {
        runId,
        query: params.userMessage,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: [],
        cached: false,
        provider: "none",
        latencyMs: Math.round(performance.now() - start),
        status: "SKIPPED",
      };
    }

    // 2. If query is strictly local vault and does not require external research:
    if (!intentAnalysis.requiresExternalResearch) {
      return {
        runId,
        query: params.userMessage,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: [],
        cached: false,
        provider: "none",
        latencyMs: Math.round(performance.now() - start),
        status: "SKIPPED",
      };
    }

    // 3. Resolve research provider
    const provider = this.getProvider(params.providerOverride);
    if (!provider) {
      return {
        runId,
        query: params.userMessage,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: [],
        cached: false,
        provider: "none",
        latencyMs: Math.round(performance.now() - start),
        status: "NO_PROVIDER",
        errorMessage: "Nenhum provedor de busca na web está configurado no sistema.",
      };
    }

    // 4. Determine queries to execute
    const queries = intentAnalysis.suggestedQueries.length > 0
      ? intentAnalysis.suggestedQueries
      : [params.userMessage.slice(0, 100)];

    const primaryQuery = queries[0];

    // 5. Check Cache
    const cachedSources = ResearchCache.get(primaryQuery, provider.name);
    if (cachedSources && cachedSources.length > 0) {
      const ranked = SourceRanking.rankAndFilter(cachedSources, 8);
      const context = ResearchContextBuilder.buildContext(ranked, runId);
      return {
        runId,
        query: primaryQuery,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: ranked,
        cached: true,
        provider: provider.name,
        latencyMs: Math.round(performance.now() - start),
        status: "SUCCESS",
        contextBlock: context.xmlBlock,
      };
    }

    // 6. Execute Provider Search across queries
    const accumulatedRawResults: SearchResult[] = [];
    let providerError: string | undefined;

    for (const q of queries) {
      try {
        const results = await provider.search(q, { maxResults: 8, timeoutMs: 8000 });
        accumulatedRawResults.push(...results);
      } catch (err: any) {
        providerError = err.message;
      }
    }

    // 7. Filter, Rank by Clinical Authority, and Deduplicate
    const rankedSources = SourceRanking.rankAndFilter(accumulatedRawResults, 8);

    if (rankedSources.length === 0) {
      return {
        runId,
        query: primaryQuery,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: [],
        cached: false,
        provider: provider.name,
        latencyMs: Math.round(performance.now() - start),
        status: "NO_SOURCES",
        errorMessage: providerError || "Nenhuma fonte relevante encontrada.",
      };
    }

    // 8. Cache successful search
    ResearchCache.set(primaryQuery, provider.name, rankedSources);

    // 9. Build XML Context Block
    const context = ResearchContextBuilder.buildContext(rankedSources, runId);

    return {
      runId,
      query: primaryQuery,
      queryHash,
      policy,
      intent: intentAnalysis.intent,
      sources: rankedSources,
      cached: false,
      provider: provider.name,
      latencyMs: Math.round(performance.now() - start),
      status: "SUCCESS",
      contextBlock: context.xmlBlock,
    };
  }
}
