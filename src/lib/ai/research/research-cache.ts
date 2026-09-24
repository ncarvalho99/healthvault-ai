import crypto from "node:crypto";
import { SearchResult } from "./types";

interface CacheEntry {
  key: string;
  sources: SearchResult[];
  cachedAt: number;
  expiresAt: number;
}

export class ResearchCache {
  private static cache = new Map<string, CacheEntry>();
  private static MAX_ENTRIES = 200;
  private static DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

  static hashQuery(query: string, provider: string): string {
    const normalized = `${provider.trim().toLowerCase()}:${query.trim().toLowerCase()}`;
    return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  }

  static get(query: string, provider: string): SearchResult[] | null {
    const key = this.hashQuery(query, provider);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.sources;
  }

  static set(query: string, provider: string, sources: SearchResult[], ttlMs?: number): void {
    const key = this.hashQuery(query, provider);
    const ttl = ttlMs || this.DEFAULT_TTL_MS;
    const now = Date.now();

    // Evict oldest if capacity exceeded
    if (this.cache.size >= this.MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      key,
      sources,
      cachedAt: now,
      expiresAt: now + ttl,
    });
  }

  static clear(): void {
    this.cache.clear();
  }

  static size(): number {
    return this.cache.size;
  }
}
