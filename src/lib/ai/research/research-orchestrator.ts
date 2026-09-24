import crypto from "node:crypto";
import {
  FailClosedReasonCode,
  ResearchExecutionResult,
  ResearchPolicy,
  ResearchStrategy,
  SearchResult,
  WebResearchProvider,
} from "./types";
import { resolveResearchPolicy } from "./research-policy";
import { ResearchIntentAnalyzer } from "./research-intent";
import { SourceRanking } from "./source-ranking";
import { ResearchCache } from "./research-cache";
import { ResearchContextBuilder } from "./research-context-builder";
import { OmniRouteSearchProvider } from "./providers/omniroute-search-provider";
import { SearXNGProvider } from "./providers/searxng-provider";
import { BraveSearchProvider } from "./providers/brave-provider";
import { resolveResearchProviderPriority } from "./provider-priority";

export interface ResearchOrchestratorOptions {
  userMessage: string;
  modelId: string;
  agentMode?: string;
  policyOverride?: ResearchPolicy;
  providerOverride?: string;
  omnirouteBaseUrl?: string;
  omnirouteApiKey?: string;
  strategy?: ResearchStrategy;
}

export class ResearchOrchestrator {
  /**
   * Instantiates the primary and fallback search provider chain.
   */
  static getProviderChain(options?: {
    providerOverride?: string;
    omnirouteBaseUrl?: string;
    omnirouteApiKey?: string;
  }): WebResearchProvider[] {
    const override = options?.providerOverride?.trim().toLowerCase();

    if (override === "searxng") {
      return [new SearXNGProvider()];
    }
    if (override === "brave") {
      const brave = new BraveSearchProvider();
      return [brave];
    }
    if (override === "omniroute") {
      return [
        new OmniRouteSearchProvider({
          baseUrl: options?.omnirouteBaseUrl,
          apiKey: options?.omnirouteApiKey,
        }),
      ];
    }

    // Default chain configured by resolved priority
    const priorityInfo = resolveResearchProviderPriority();
    const chain: WebResearchProvider[] = [];

    if (priorityInfo.omnirouteSubProviders.length > 0) {
      chain.push(
        new OmniRouteSearchProvider({
          baseUrl: options?.omnirouteBaseUrl,
          apiKey: options?.omnirouteApiKey,
          defaultSubProvider: priorityInfo.omnirouteSubProviders[0],
          subProviderPriority: priorityInfo.omnirouteSubProviders,
        })
      );
    }

    if (priorityInfo.directFallbacks.includes("searxng")) {
      chain.push(new SearXNGProvider());
    }

    if (priorityInfo.directFallbacks.includes("brave") || process.env.BRAVE_SEARCH_API_KEY) {
      chain.push(new BraveSearchProvider());
    }

    return chain;
  }

  /**
   * Orchestrates the complete Web-First Research pipeline.
   */
  static async execute(params: ResearchOrchestratorOptions): Promise<ResearchExecutionResult> {
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

    // 3. Resolve research provider chain
    const providers = this.getProviderChain({
      providerOverride: params.providerOverride,
      omnirouteBaseUrl: params.omnirouteBaseUrl,
      omnirouteApiKey: params.omnirouteApiKey,
    });

    if (providers.length === 0) {
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
        reasonCode: "NO_PROVIDER",
        errorMessage: "Nenhum provedor de busca na web configurado no sistema.",
      };
    }

    // 4. Formulate deterministic search queries (suggested + domain targeted)
    const baseQueries = intentAnalysis.suggestedQueries.length > 0
      ? intentAnalysis.suggestedQueries
      : [params.userMessage.slice(0, 100)];

    const primaryQuery = baseQueries[0];
    const strategy: ResearchStrategy =
      params.strategy ||
      (process.env.WEB_RESEARCH_STRATEGY as ResearchStrategy) ||
      (intentAnalysis.intent === "EXTERNAL_KNOWLEDGE" ? "aggregate" : "first_healthy");

    // 5. Check Cache for primary query
    const cachedSources = ResearchCache.get(primaryQuery, "multi-gateway");
    if (cachedSources && cachedSources.length > 0) {
      const ranked = SourceRanking.rankAndFilter(cachedSources, 8);
      const evidenceEval = SourceRanking.evaluateMinimumEvidence(ranked, intentAnalysis.isClinicalSafetyQuery);

      if (evidenceEval.eligible) {
        const context = ResearchContextBuilder.buildContext(ranked, runId);
        return {
          runId,
          query: primaryQuery,
          queryHash,
          policy,
          intent: intentAnalysis.intent,
          sources: ranked,
          cached: true,
          provider: "cache",
          latencyMs: Math.round(performance.now() - start),
          status: "SUCCESS",
          rawResultCount: cachedSources.length,
          normalizedResultCount: cachedSources.length,
          rankedResultCount: ranked.length,
          trustedResultCount: evidenceEval.trustedCount,
          contextBlock: context.xmlBlock,
        };
      }
    }

    // 6. Execute Provider Chain with Failover and Aggregation
    const accumulatedRawResults: SearchResult[] = [];
    const providersAttempted: string[] = [];
    let lastErrorDetail: string | undefined;

    // Queries to execute: base queries plus first domain-targeted query if available
    const queriesToRun = [...baseQueries];
    if (intentAnalysis.domainTargetedQueries && intentAnalysis.domainTargetedQueries.length > 0) {
      queriesToRun.push(intentAnalysis.domainTargetedQueries[0]);
    }

    for (const provider of providers) {
      providersAttempted.push(provider.name);
      let providerProducedResults = false;

      for (const q of queriesToRun.slice(0, 3)) {
        try {
          const results = await provider.search(q, { maxResults: 8, timeoutMs: 12000 });
          if (Array.isArray(results) && results.length > 0) {
            accumulatedRawResults.push(...results);
            providerProducedResults = true;
          }
        } catch (err: any) {
          lastErrorDetail = err.message;
        }
      }

      // If strategy is first_healthy and this provider produced results, stop failover
      if (strategy === "first_healthy" && providerProducedResults) {
        break;
      }
    }

    const rawResultCount = accumulatedRawResults.length;

    // 7. Check if raw results were gathered
    if (rawResultCount === 0) {
      const reasonCode: FailClosedReasonCode = providersAttempted.length > 0 ? "NO_RAW_RESULTS" : "ALL_PROVIDERS_FAILED";
      return {
        runId,
        query: primaryQuery,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: [],
        cached: false,
        provider: providersAttempted.join("+"),
        providersAttempted,
        latencyMs: Math.round(performance.now() - start),
        status: "NO_SOURCES",
        reasonCode,
        rawResultCount: 0,
        normalizedResultCount: 0,
        rankedResultCount: 0,
        trustedResultCount: 0,
        errorMessage: lastErrorDetail || "Nenhum resultado retornado pelos provedores de busca.",
      };
    }

    // 8. Rank and Apply Clinical Authority Scoring
    const rankedSources = SourceRanking.rankAndFilter(accumulatedRawResults, 8);
    const rankedResultCount = rankedSources.length;

    // 9. Evaluate Minimum Evidence Policy
    const evidenceEval = SourceRanking.evaluateMinimumEvidence(rankedSources, intentAnalysis.isClinicalSafetyQuery);

    if (!evidenceEval.eligible) {
      return {
        runId,
        query: primaryQuery,
        queryHash,
        policy,
        intent: intentAnalysis.intent,
        sources: rankedSources,
        cached: false,
        provider: providersAttempted.join("+"),
        providersAttempted,
        latencyMs: Math.round(performance.now() - start),
        status: "NO_SOURCES",
        reasonCode: evidenceEval.reasonCode || "INSUFFICIENT_EVIDENCE",
        rawResultCount,
        normalizedResultCount: accumulatedRawResults.length,
        rankedResultCount,
        trustedResultCount: evidenceEval.trustedCount,
        errorMessage: evidenceEval.evidenceCaveat || "Fontes obtidas não atingem o limiar de evidência clínica exigido.",
      };
    }

    // 10. Cache successful search
    ResearchCache.set(primaryQuery, "multi-gateway", rankedSources);

    // 11. Build XML Context Block
    const context = ResearchContextBuilder.buildContext(rankedSources, runId);

    return {
      runId,
      query: primaryQuery,
      queryHash,
      policy,
      intent: intentAnalysis.intent,
      sources: rankedSources,
      cached: false,
      provider: providersAttempted.join("+"),
      providersAttempted,
      latencyMs: Math.round(performance.now() - start),
      status: "SUCCESS",
      rawResultCount,
      normalizedResultCount: accumulatedRawResults.length,
      rankedResultCount,
      trustedResultCount: evidenceEval.trustedCount,
      contextBlock: context.xmlBlock,
    };
  }
}
