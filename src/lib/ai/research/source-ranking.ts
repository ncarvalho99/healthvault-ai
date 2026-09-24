import { SearchResult } from "./types";

const TIER_1_DOMAINS = [
  "fda.gov",
  "ema.europa.eu",
  "anvisa.gov.br",
  "gov.br",
  "who.int",
  "saude.gov.br",
  "clinicaltrials.gov",
  "ncbi.nlm.nih.gov",
  "pubmed.ncbi.nlm.nih.gov",
  "dailymed.nlm.nih.gov",
  "nice.org.uk",
  "nejm.org",
  "thelancet.com",
  "jamanetwork.com",
  "bmj.com",
];

const TIER_2_DOMAINS = [
  "mayoclinic.org",
  "hopkinsmedicine.org",
  "clevelandclinic.org",
  "health.harvard.edu",
  "cochranelibrary.com",
  "endocrine.org",
  "diabetes.org",
  "heart.org",
  "nature.com",
  "cell.com",
  "sciencedirect.com",
  "frontiersin.org",
  "biomedcentral.com",
];

const TIER_3_DOMAINS = [
  "webmd.com",
  "medscape.com",
  "healthline.com",
  "drugs.com",
  "rxlist.com",
  "examine.com",
  "verywellhealth.com",
  "medicalnewstoday.com",
  "statpearls.com",
];

const ANECDOTAL_DOMAINS = [
  "reddit.com",
  "twitter.com",
  "x.com",
  "quora.com",
  "medium.com",
  "tiktok.com",
  "erowid.org",
  "bluelight.org",
  "longevity.technology",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "substack.com",
  "wordpress.com",
  "blogspot.com",
];

export class SourceRanking {
  /**
   * Extracts clean host domain from a URL.
   */
  static extractDomain(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      return parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  }

  /**
   * Canonicalizes URL for deduplication by removing tracking params.
   */
  static canonicalizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      parsed.hash = "";
      const searchParams = new URLSearchParams(parsed.search);
      const trackingKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"];
      for (const k of trackingKeys) {
        searchParams.delete(k);
      }
      parsed.search = searchParams.toString();
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      return rawUrl.trim();
    }
  }

  /**
   * Classifies a domain into clinical authority tiers (1 to 4).
   */
  static classifyDomain(domain: string): { tier: 1 | 2 | 3 | 4; isAnecdotal: boolean } {
    const d = domain.toLowerCase();

    // Check Anecdotal first
    for (const ad of ANECDOTAL_DOMAINS) {
      if (d === ad || d.endsWith("." + ad)) {
        return { tier: 4, isAnecdotal: true };
      }
    }

    // Check Tier 1
    for (const t1 of TIER_1_DOMAINS) {
      if (d === t1 || d.endsWith("." + t1)) {
        return { tier: 1, isAnecdotal: false };
      }
    }

    // Check Tier 2
    for (const t2 of TIER_2_DOMAINS) {
      if (d === t2 || d.endsWith("." + t2)) {
        return { tier: 2, isAnecdotal: false };
      }
    }

    // Check Tier 3
    for (const t3 of TIER_3_DOMAINS) {
      if (d === t3 || d.endsWith("." + t3)) {
        return { tier: 3, isAnecdotal: false };
      }
    }

    // Default general web domain
    return { tier: 3, isAnecdotal: false };
  }

  /**
   * Deduplicates, ranks, and filters raw search results by clinical authority.
   */
  static rankAndFilter(rawResults: SearchResult[], maxResults = 8): SearchResult[] {
    const seenUrls = new Set<string>();
    const scored: Array<{ result: SearchResult; score: number }> = [];

    for (const r of rawResults) {
      if (!r.url || !r.title) continue;
      const canonical = this.canonicalizeUrl(r.url);
      if (seenUrls.has(canonical)) continue;
      seenUrls.add(canonical);

      const domain = this.extractDomain(canonical);
      const { tier, isAnecdotal } = this.classifyDomain(domain);

      // Score base calculation:
      // Tier 1: 1000 base
      // Tier 2: 700 base
      // Tier 3: 400 base
      // Tier 4 (anecdotal): 50 base (penalized heavily)
      let baseScore = 400;
      if (tier === 1) baseScore = 1000;
      else if (tier === 2) baseScore = 700;
      else if (tier === 4 || isAnecdotal) baseScore = 50;

      // Bonus for recent dates or clinical trial identifiers
      let bonus = 0;
      const textToSearch = `${r.title} ${r.snippet || ""}`.toLowerCase();
      if (/clinicaltrials\.gov|nct\d{8}/i.test(textToSearch)) bonus += 150;
      if (/phase\s+(1|2|3|i|ii|iii)|randomized|double-blind|placebo/i.test(textToSearch)) bonus += 100;
      if (/guideline|fda approval|anvisa|prescribing information/i.test(textToSearch)) bonus += 100;
      if (/202[56]/i.test(textToSearch)) bonus += 50;

      const totalScore = baseScore + bonus;

      scored.push({
        score: totalScore,
        result: {
          ...r,
          url: canonical,
          sourceDomain: domain,
          tier,
          isAnecdotal,
          score: totalScore,
        },
      });
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Take top maxResults and re-assign stable IDs S1, S2...
    return scored.slice(0, maxResults).map((item, idx) => ({
      ...item.result,
      id: `S${idx + 1}`,
    }));
  }
}
