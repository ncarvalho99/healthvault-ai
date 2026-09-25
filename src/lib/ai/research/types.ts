/**
 * Web-First Research Core Types
 */

export type ResearchPolicy = "AUTO" | "REQUIRED" | "OFF";

export type ResearchStrategy = "first_healthy" | "aggregate";

export type ResearchIntentType =
  | "LOCAL_VAULT_ONLY"
  | "EXTERNAL_KNOWLEDGE"
  | "CURRENT_INFORMATION"
  | "MIXED"
  | "AMBIGUOUS";

export type FailClosedReasonCode =
  | "NO_PROVIDER"
  | "PROVIDER_TIMEOUT"
  | "NO_RAW_RESULTS"
  | "NO_NORMALIZED_RESULTS"
  | "NO_TRUSTED_RESULTS"
  | "INSUFFICIENT_EVIDENCE"
  | "ALL_PROVIDERS_FAILED";

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
  rawScore?: number;
  searchProvider?: string;
}

export interface SubProviderProbeResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs: number;
  resultCount: number;
  error?: string;
}

export interface ProviderHealth {
  ok: boolean;
  provider: string;
  latencyMs?: number;
  error?: string;
  availableSubProviders?: string[];
  status?: "HEALTHY" | "DEGRADED" | "DOWN" | "UNCONFIGURED";
  subProviderProbes?: Record<string, SubProviderProbeResult>;
}

export interface SearchOptions {
  maxResults?: number;
  timeoutMs?: number;
  categories?: string[];
  subProvider?: string;
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
  domainTargetedQueries?: string[];
  entities: string[];
  reason: string;
  isClinicalSafetyQuery?: boolean;
  vaultResolutionUsed?: boolean;
  resolvedEntityTypes?: string[];
  resolvedEntityCount?: number;
  hasAmbiguity?: boolean;
  ambiguousItems?: string[];
}

export interface ResolvedVaultEntity {
  type: "medication" | "diet" | "metric";
  name: string;
  dose?: string;
  form?: string;
  details?: string;
}

export interface VaultResolutionResult {
  used: boolean;
  resolvedEntities: ResolvedVaultEntity[];
  resolvedEntityTypes: string[];
  resolvedEntityCount: number;
  hasAmbiguity: boolean;
  ambiguityType?: "MULTIPLE_ACTIVE_MEDICATIONS";
  ambiguousItems?: string[];
  suggestedQueries: string[];
  domainTargetedQueries: string[];
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
  reasonCode?: FailClosedReasonCode;
  rawResultCount?: number;
  normalizedResultCount?: number;
  rankedResultCount?: number;
  trustedResultCount?: number;
  providersAttempted?: string[];
  contextBlock?: string;
  errorMessage?: string;
  vaultResolutionUsed?: boolean;
  resolvedEntityTypes?: string[];
  resolvedEntityCount?: number;
  hasAmbiguity?: boolean;
  ambiguousItems?: string[];
}

export interface ResearchMetadata {
  researchUsed: boolean;
  researchRunId?: string;
  researchPolicy: ResearchPolicy;
  researchStatus: string;
  reasonCode?: FailClosedReasonCode;
  provider?: string;
  providersAttempted?: string[];
  rawResultCount?: number;
  sourcesCount: number;
  vaultResolutionUsed?: boolean;
  resolvedEntityTypes?: string[];
  resolvedEntityCount?: number;
  hasAmbiguity?: boolean;
  ambiguousItems?: string[];
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
