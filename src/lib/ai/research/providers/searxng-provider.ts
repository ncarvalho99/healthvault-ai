import { WebResearchProvider, SearchResult, SearchOptions, ProviderHealth } from "../types";

export class SearXNGProvider implements WebResearchProvider {
  name = "searxng";
  private baseUrl: string;

  constructor(customBaseUrl?: string) {
    this.baseUrl = (
      customBaseUrl ||
      process.env.SEARXNG_BASE_URL ||
      "http://172.26.128.61:8888"
    ).trim().replace(/\/+$/, "");
  }

  /**
   * Validates target search endpoint against SSRF risks.
   * Blocks metadata endpoints, non-HTTP protocols, and CRLF injections.
   */
  private validateUrl(targetUrl: string): boolean {
    try {
      if (/[\r\n\t]/.test(targetUrl)) {
        return false;
      }
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      // Block cloud metadata services and loopback spoofing
      if (
        host === "169.254.169.254" ||
        host.includes("metadata.google.internal") ||
        host === "100.100.100.200" ||
        host === "169.254.170.2" ||
        host.endsWith(".internal")
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const timeoutMs = options?.timeoutMs || 10000;
    const maxResults = options?.maxResults || 8;

    const endpoint = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general,science`;
    if (!this.validateUrl(endpoint)) {
      throw new Error(`SSRF Validation rejected SearXNG endpoint: ${this.baseUrl}`);
    }

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "HealthVault-WebResearch/1.0",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`SearXNG search failed with HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const rawResults = Array.isArray(data?.results) ? data.results : [];

    const now = new Date().toISOString();
    const results: SearchResult[] = [];

    for (let i = 0; i < rawResults.length; i++) {
      const item = rawResults[i];
      if (!item.url || !item.title) continue;

      results.push({
        id: `S${results.length + 1}`,
        title: String(item.title).trim(),
        url: String(item.url).trim(),
        snippet: item.content ? String(item.content).trim() : undefined,
        publishedAt: item.publishedDate ? String(item.publishedDate) : undefined,
        tier: 3, // Classified dynamically by SourceRanking
        isAnecdotal: false,
        retrievedAt: now,
      });

      if (results.length >= maxResults * 2) break; // Gather surplus for ranking filter
    }

    return results;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = performance.now();
    try {
      const endpoint = `${this.baseUrl}/search?q=health&format=json`;
      if (!this.validateUrl(endpoint)) {
        return { ok: false, provider: this.name, error: "SSRF validation failed" };
      }

      const res = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
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
