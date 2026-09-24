/**
 * Web-First Research Core Types
 */

export type ResearchPolicy = "AUTO" | "REQUIRED" | "OFF";

export type ResearchIntentType =
  | "LOCAL_VAULT_ONLY"
  | "EXTERNAL_KNOWLEDGE"
  | "CURRENT_INFORMATION"
  | "AMBIGUOUS";

export interface SearchResult {
  id: string; // e.g. "S1", "S2"
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  sourceDomain?: string;
  score?: number;
  tier: 1 | 2 | 3 | 4; // 1 = regulatory/pubmed, 2 = academic/societies, 3 = secondary, 4 = anecdotal
  isAnecdotal: boolean;
  retrievedAt: string;
}

export interface ProviderHealth {
  ok: boolean;
  provider: string;
  latencyMs?: number;
  error?: string;
}

export interface SearchOptions {
  maxResults?: number;
  timeoutMs?: number;
  categories?: string[];
}

export interface WebResearchProvider {
  name: string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  healthCheck(): Promise<ProviderHealth>;
}

export interface ResearchIntentAnalysis {
  intent: ResearchIntentType;
  requiresExternalResearch: boolean;
  suggestedQueries: string[];
  entities: string[];
  reason: string;
}

export interface ResearchContext {
  runId: string;
  xmlBlock: string;
  sources: SearchResult[];
  totalSources: number;
}

export interface ResearchExecutionResult {
  runId: string;
  query: string;
  queryHash: string;
  policy: ResearchPolicy;
  intent: ResearchIntentType;
  sources: SearchResult[];
  cached: boolean;
  provider: string;
  latencyMs: number;
  status: "SUCCESS" | "SKIPPED" | "NO_PROVIDER" | "NO_SOURCES" | "FAILED";
  contextBlock?: string;
  errorMessage?: string;
}

export interface ResearchMetadata {
  researchUsed: boolean;
  researchRunId?: string;
  researchPolicy: ResearchPolicy;
  researchStatus: string;
  provider?: string;
  sourcesCount: number;
  sources?: Array<{
    id: string;
    title: string;
    url: string;
    domain: string;
    tier: number;
    isAnecdotal: boolean;
    publishedAt?: string;
    retrievedAt: string;
  }>;
}
