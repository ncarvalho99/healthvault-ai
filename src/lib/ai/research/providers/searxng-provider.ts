import { WebResearchProvider, SearchResult, SearchOptions, ProviderHealth } from "../types";

export class SearXNGProvider implements WebResearchProvider {
  name = "searxng";
  private baseUrl: string;

  constructor(customBaseUrl?: string) {
    this.baseUrl = (
      customBaseUrl ||
      process.env.SEARXNG_BASE_URL ||
      ""
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

  /**
   * Performs search with automatic category fallback:
   * First tries 'general' (fastest & most reliable across instances).
   * If empty or fails, falls back to 'science' or no category restriction.
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.baseUrl) {
      return [];
    }

    const timeoutMs = options?.timeoutMs || 8000;
    const maxResults = options?.maxResults || 8;

    // Categories to attempt in order
    const categoryAttempts = options?.categories && options.categories.length > 0
      ? [options.categories.join(","), "general", ""]
      : ["general", "science", ""];

    let lastError: Error | null = null;

    for (const cat of categoryAttempts) {
      try {
        const catParam = cat ? `&categories=${encodeURIComponent(cat)}` : "";
        const endpoint = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&format=json${catParam}`;

        if (!this.validateUrl(endpoint)) {
          throw new Error(`SSRF Validation rejected SearXNG endpoint: ${this.baseUrl}`);
        }

        const res = await fetch(endpoint, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "HealthVault-WebResearch/2.0",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          throw new Error(`SearXNG HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        const rawResults = Array.isArray(data?.results) ? data.results : [];

        if (rawResults.length === 0) {
          // If no results for this category, attempt fallback category
          continue;
        }

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
            searchProvider: `searxng:${cat || "all"}`,
          });

          if (results.length >= maxResults * 2) break;
        }

        if (results.length > 0) {
          return results;
        }
      } catch (err: any) {
        lastError = err;
        // On error (e.g. timeout on complex category), continue to next fallback category
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.baseUrl) {
      return {
        ok: false,
        provider: this.name,
        latencyMs: 0,
        status: "UNCONFIGURED",
        error: "SearXNG URL is not configured (missing SEARXNG_BASE_URL)",
      };
    }

    const start = performance.now();
    try {
      const endpoint = `${this.baseUrl}/search?q=health&format=json&categories=general`;
      if (!this.validateUrl(endpoint)) {
        return { ok: false, provider: this.name, status: "DOWN", error: "SSRF validation failed" };
      }

      const res = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        return { ok: false, provider: this.name, latencyMs, status: "DOWN", error: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const hasResults = Array.isArray(data?.results) && data.results.length > 0;

      return {
        ok: true,
        provider: this.name,
        latencyMs,
        status: hasResults ? "HEALTHY" : "DEGRADED",
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
