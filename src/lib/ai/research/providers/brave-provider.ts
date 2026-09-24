import { WebResearchProvider, SearchResult, SearchOptions, ProviderHealth } from "../types";

export class BraveSearchProvider implements WebResearchProvider {
  name = "brave";
  private apiKey: string;
  private endpoint = "https://api.search.brave.com/res/v1/web/search";

  constructor(customApiKey?: string) {
    this.apiKey = (customApiKey || process.env.BRAVE_SEARCH_API_KEY || "").trim();
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error("Brave Search provider is not configured (missing BRAVE_SEARCH_API_KEY)");
    }

    const timeoutMs = options?.timeoutMs || 10000;
    const maxResults = options?.maxResults || 8;

    const url = `${this.endpoint}?q=${encodeURIComponent(query)}&count=10`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Brave Search failed with HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const rawResults = Array.isArray(data?.web?.results) ? data.web.results : [];

    const now = new Date().toISOString();
    const results: SearchResult[] = [];

    for (let i = 0; i < rawResults.length; i++) {
      const item = rawResults[i];
      if (!item.url || !item.title) continue;

      results.push({
        id: `S${results.length + 1}`,
        title: String(item.title).trim(),
        url: String(item.url).trim(),
        snippet: item.description ? String(item.description).trim() : undefined,
        publishedAt: item.page_age ? String(item.page_age) : undefined,
        tier: 3,
        isAnecdotal: false,
        retrievedAt: now,
      });

      if (results.length >= maxResults * 2) break;
    }

    return results;
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.apiKey) {
      return { ok: false, provider: this.name, error: "Brave Search API Key not configured" };
    }

    const start = performance.now();
    try {
      const res = await fetch(`${this.endpoint}?q=ping&count=1`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        return { ok: false, provider: this.name, latencyMs, error: `HTTP ${res.status}` };
      }

      return { ok: true, provider: this.name, latencyMs };
    } catch (err: any) {
      return {
        ok: false,
        provider: this.name,
        latencyMs: Math.round(performance.now() - start),
        error: err.message,
      };
    }
  }
}
