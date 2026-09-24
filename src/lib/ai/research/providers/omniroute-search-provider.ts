import crypto from "node:crypto";
import { WebResearchProvider, SearchResult, SearchOptions, ProviderHealth } from "../types";

export interface OmniRouteSearchProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  defaultSubProvider?: string;
  subProviderPriority?: string[];
}

export class OmniRouteSearchProvider implements WebResearchProvider {
  name = "omniroute";
  private baseUrl: string;
  private apiKey: string;
  private defaultSubProvider: string;
  private subProviderPriority: string[];

  constructor(options?: OmniRouteSearchProviderOptions) {
    const rawBaseUrl =
      options?.baseUrl ||
      process.env.OMNIROUTE_BASE_URL ||
      process.env.E2E_AI_BASE_URL ||
      "https://omniroute-local.nclabs.dev/v1";

    this.baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
    this.apiKey = (options?.apiKey || process.env.OMNIROUTE_API_KEY || process.env.E2E_AI_API_KEY || "").trim();
    this.defaultSubProvider = (options?.defaultSubProvider || "firecrawl").trim();
    this.subProviderPriority = options?.subProviderPriority || ["firecrawl", "ollama-search", "serper-search"];
  }

  setCredentials(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = apiKey.trim();
  }

  getSearchEndpoint(): string {
    const clean = this.baseUrl.replace(/\/v1$/, "");
    return `${clean}/v1/search`;
  }

  /**
   * Executes a search on OmniRoute /v1/search with automatic sub-provider failover.
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const endpoint = this.getSearchEndpoint();
    const timeoutMs = options?.timeoutMs || 15000;
    const maxResults = options?.maxResults || 8;

    // Sub-provider hierarchy: explicit option > defaultSubProvider > priority list
    const candidateProviders = options?.subProvider
      ? [options.subProvider]
      : [this.defaultSubProvider, ...this.subProviderPriority.filter((p) => p !== this.defaultSubProvider), undefined];

    let lastError: Error | null = null;

    for (const subProvider of candidateProviders) {
      try {
        const body: Record<string, any> = {
          query,
          max_results: maxResults,
        };
        if (subProvider) {
          body.provider = subProvider;
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Request-Id": crypto.randomUUID(),
        };
        if (this.apiKey) {
          headers["Authorization"] = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          let errDetail = `HTTP ${res.status} ${res.statusText}`;
          try {
            const errJson = await res.json();
            if (errJson?.error?.message) errDetail = errJson.error.message;
          } catch {
            // ignore
          }
          throw new Error(`OmniRoute Search (${subProvider || "default"}) failed: ${errDetail}`);
        }

        const data = await res.json();
        const rawItems = Array.isArray(data) ? data : data.results || data.data || [];

        if (!Array.isArray(rawItems) || rawItems.length === 0) {
          // If this subprovider returned 0 results, try next subprovider before giving up
          continue;
        }

        const now = new Date().toISOString();
        const results: SearchResult[] = [];

        for (let i = 0; i < rawItems.length; i++) {
          const item = rawItems[i];
          const url = (item.url || item.link || "").trim();
          const title = (item.title || item.name || "").trim();
          if (!url || !title) continue;

          results.push({
            id: `S${results.length + 1}`,
            title,
            url,
            snippet: item.snippet || item.content || item.description || undefined,
            publishedAt: item.published_at || item.publishedDate || item.date || undefined,
            tier: 3, // Classified dynamically by SourceRanking
            isAnecdotal: false,
            retrievedAt: now,
            searchProvider: `omniroute:${subProvider || "default"}`,
          });

          if (results.length >= maxResults * 2) break;
        }

        if (results.length > 0) {
          return results;
        }
      } catch (err: any) {
        lastError = err;
        // Continue to next candidate subprovider in failover chain
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }

  /**
   * Health check and sub-provider discovery via GET /v1/search
   */
  async healthCheck(): Promise<ProviderHealth> {
    const endpoint = this.getSearchEndpoint();
    const start = performance.now();

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        return {
          ok: false,
          provider: this.name,
          latencyMs,
          status: "DOWN",
          error: `HTTP ${res.status} ${res.statusText}`,
        };
      }

      const data = await res.json();
      const rawProviders = Array.isArray(data?.data) ? data.data : [];
      const availableSubProviders = rawProviders.map((p: any) => String(p.id));

      const hasFirecrawl = availableSubProviders.includes("firecrawl");

      return {
        ok: true,
        provider: this.name,
        latencyMs,
        status: hasFirecrawl ? "HEALTHY" : "DEGRADED",
        availableSubProviders,
      };
    } catch (err: any) {
      return {
        ok: false,
        provider: this.name,
        latencyMs: Math.round(performance.now() - start),
        status: "DOWN",
        error: err.message,
      };
    }
  }
}
