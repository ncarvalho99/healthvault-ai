import crypto from "node:crypto";
import {
  FailClosedReasonCode,
  ResearchExecutionResult,
  ResearchPolicy,
  ResearchStrategy,
  SearchResult,
  VaultResolutionResult,
  WebResearchProvider,
} from "./types";
import { resolveResearchPolicy } from "./research-policy";
import { ResearchIntentAnalyzer } from "./research-intent";
import { VaultEntityResolver } from "./vault-entity-resolver";
import { SourceRanking } from "./source-ranking";
import { ResearchCache } from "./research-cache";
import { ResearchContextBuilder } from "./research-context-builder";
import { OmniRouteSearchProvider } from "./providers/omniroute-search-provider";
import { SearXNGProvider } from "./providers/searxng-provider";
import { BraveSearchProvider } from "./providers/brave-provider";
import { resolveResearchProviderPriority } from "./provider-priority";
import { QuerySanitizer } from "./query-sanitizer";

export interface ResearchOrchestratorOptions {
  userId?: string;
  userMessage: string;
  modelId: string;
  agentMode?: string;
  policyOverride?: ResearchPolicy;
  providerOverride?: string;
  omnirouteBaseUrl?: string;
  omnirouteApiKey?: string;
  strategy?: ResearchStrategy;
  dbClient?: any;
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

    // Build chain according to resolved priority segments
    const priorityInfo = resolveResearchProviderPriority();
    const chain: WebResearchProvider[] = [];

    for (const seg of priorityInfo.chainSegments) {
      if (seg.type === "omniroute") {
        chain.push(
          new OmniRouteSearchProvider({
            baseUrl: options?.omnirouteBaseUrl,
            apiKey: options?.omnirouteApiKey,
            defaultSubProvider: seg.subProviders[0],
            subProviderPriority: seg.subProviders,
          })
        );
      } else if (seg.type === "searxng") {
        chain.push(new SearXNGProvider());
      } else if (seg.type === "brave") {
        chain.push(new BraveSearchProvider());
      }
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
        vaultResolutionUsed: false,
        resolvedEntityTypes: [],
        resolvedEntityCount: 0,
      };
    }

    // 2. If query is strictly local vault and does not require external research:
    if (!intentAnalysis.requiresExternalResearch) {
      // Defense-in-depth for policy === "REQUIRED":
      // If user message contains explicit clinical safety, interaction, or external signals, do NOT skip silently!
      const text = params.userMessage.toLowerCase();
      const hasClinicalSignals =
        /intera[cç]|combin|contraindica|efeito|bula|diretriz|guideline|estudo|ensaio|fda|anvisa|seguran[cç]a|risco/i.test(text);

      if (policy === "REQUIRED" && hasClinicalSignals) {
        // Recover and force research as MIXED rather than falling back to model memory
        intentAnalysis.requiresExternalResearch = true;
        intentAnalysis.intent = "MIXED";
        intentAnalysis.reason = "Forced research under REQUIRED policy (RESEARCH_CLASSIFICATION_MISMATCH prevented)";
      } else {
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
          vaultResolutionUsed: false,
          resolvedEntityTypes: [],
          resolvedEntityCount: 0,
        };
      }
    }

    // 2.5. Vault Entity Resolution for MIXED research intent
    let vaultResolution: VaultResolutionResult = {
      used: false,
      status: "NONE",
      resolvedEntities: [],
      resolvedEntityTypes: [],
      resolvedEntityCount: 0,
      hasAmbiguity: false,
      suggestedQueries: [],
      domainTargetedQueries: [],
    };

    if (intentAnalysis.intent === "MIXED" && params.userId) {
      vaultResolution = await VaultEntityResolver.resolve({
        userId: params.userId,
        userMessage: params.userMessage,
        intent: intentAnalysis.intent,
        externalEntities: intentAnalysis.entities,
        dbClient: params.dbClient,
      });

      if (vaultResolution.status === "NEEDS_DISAMBIGUATION") {
        // Disambiguation required: do not perform external web search until user selects specific medication
        const disambiguationXml = `\n<vault_disambiguation_required>\nO usuário possui ${vaultResolution.resolvedEntityCount} medicamentos ativos registrados no HealthVault: ${vaultResolution.ambiguousItems?.join(", ")}.\nA referência na pergunta é ambígua ("meu medicamento atual"). Não foi realizada pesquisa web externa específica até que o usuário indique sobre qual medicamento ativo deseja consultar. Solicite educadamente ao usuário a escolha de um dos medicamentos listados.\n</vault_disambiguation_required>\n`;

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
          status: "NEEDS_DISAMBIGUATION",
          contextBlock: disambiguationXml,
          vaultResolutionUsed: true,
          resolvedEntityTypes: vaultResolution.resolvedEntityTypes,
          resolvedEntityCount: vaultResolution.resolvedEntityCount,
          hasAmbiguity: true,
          ambiguousItems: vaultResolution.ambiguousItems,
        };
      }

      if (vaultResolution.used) {
        if (vaultResolution.suggestedQueries.length > 0) {
          intentAnalysis.suggestedQueries = vaultResolution.suggestedQueries;
        }
        if (vaultResolution.domainTargetedQueries.length > 0) {
          intentAnalysis.domainTargetedQueries = vaultResolution.domainTargetedQueries;
        }
        intentAnalysis.vaultResolutionUsed = true;
        intentAnalysis.resolvedEntityTypes = vaultResolution.resolvedEntityTypes;
        intentAnalysis.resolvedEntityCount = vaultResolution.resolvedEntityCount;
        intentAnalysis.hasAmbiguity = vaultResolution.hasAmbiguity;
        intentAnalysis.ambiguousItems = vaultResolution.ambiguousItems;
      }
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
        vaultResolutionUsed: vaultResolution.used,
        resolvedEntityTypes: vaultResolution.resolvedEntityTypes,
        resolvedEntityCount: vaultResolution.resolvedEntityCount,
        hasAmbiguity: vaultResolution.hasAmbiguity,
        ambiguousItems: vaultResolution.ambiguousItems,
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
        if (vaultResolution.hasAmbiguity && vaultResolution.ambiguousItems) {
          context.xmlBlock += `\n<!-- VAULT_AMBIGUITY_NOTE: Patient has multiple active medications (${vaultResolution.ambiguousItems.join(", ")}). Research queries covered each active medication. Advise patient on each or request clarification if necessary. -->\n`;
        }
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
          vaultResolutionUsed: vaultResolution.used,
          resolvedEntityTypes: vaultResolution.resolvedEntityTypes,
          resolvedEntityCount: vaultResolution.resolvedEntityCount,
          hasAmbiguity: vaultResolution.hasAmbiguity,
          ambiguousItems: vaultResolution.ambiguousItems,
        };
      }
    }

    // 6. Execute Provider Chain with Failover and Aggregation
    const accumulatedRawResults: SearchResult[] = [];
    const providersAttempted: string[] = [];
    let lastErrorDetail: string | undefined;

    // Formulate queries to run, guaranteeing at least 1 domain-targeted query in the top 3
    const rawQueriesToRun: string[] = [];
    if (baseQueries.length > 0) {
      rawQueriesToRun.push(baseQueries[0]);
    }
    if (intentAnalysis.domainTargetedQueries && intentAnalysis.domainTargetedQueries.length > 0) {
      rawQueriesToRun.push(intentAnalysis.domainTargetedQueries[0]);
    }
    for (let i = 1; i < baseQueries.length; i++) {
      rawQueriesToRun.push(baseQueries[i]);
    }
    if (intentAnalysis.domainTargetedQueries && intentAnalysis.domainTargetedQueries.length > 1) {
      rawQueriesToRun.push(intentAnalysis.domainTargetedQueries[1]);
    }

    const knownEntityNames = [
      ...vaultResolution.resolvedEntities.map((e: any) => e.name),
      ...intentAnalysis.entities,
    ];

    // Server-side privacy minimization & PII redaction on all search queries
    const queriesToRun = Array.from(
      new Set(
        rawQueriesToRun
          .map((q) => QuerySanitizer.sanitizeAndMinimize(q, knownEntityNames))
          .filter((q) => q.length > 0)
      )
    );

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
        vaultResolutionUsed: vaultResolution.used,
        resolvedEntityTypes: vaultResolution.resolvedEntityTypes,
        resolvedEntityCount: vaultResolution.resolvedEntityCount,
        hasAmbiguity: vaultResolution.hasAmbiguity,
        ambiguousItems: vaultResolution.ambiguousItems,
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
        vaultResolutionUsed: vaultResolution.used,
        resolvedEntityTypes: vaultResolution.resolvedEntityTypes,
        resolvedEntityCount: vaultResolution.resolvedEntityCount,
        hasAmbiguity: vaultResolution.hasAmbiguity,
        ambiguousItems: vaultResolution.ambiguousItems,
      };
    }

    // 10. Cache successful search
    ResearchCache.set(primaryQuery, "multi-gateway", rankedSources);

    // 11. Build XML Context Block
    const context = ResearchContextBuilder.buildContext(rankedSources, runId);
    if (vaultResolution.hasAmbiguity && vaultResolution.ambiguousItems) {
      context.xmlBlock += `\n<!-- VAULT_AMBIGUITY_NOTE: Patient has multiple active medications (${vaultResolution.ambiguousItems.join(", ")}). Research queries covered each active medication. Advise patient on each or request clarification if necessary. -->\n`;
    }

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
      vaultResolutionUsed: vaultResolution.used,
      resolvedEntityTypes: vaultResolution.resolvedEntityTypes,
      resolvedEntityCount: vaultResolution.resolvedEntityCount,
      hasAmbiguity: vaultResolution.hasAmbiguity,
      ambiguousItems: vaultResolution.ambiguousItems,
    };
  }
}
