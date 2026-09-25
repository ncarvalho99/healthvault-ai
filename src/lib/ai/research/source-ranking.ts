import { SearchResult, FailClosedReasonCode } from "./types";

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
  "trials.lilly.com",
  "trials.novonordisk.com",
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
  "lilly.com",
  "novonordisk.com",
  "clinicaltrialsarena.com",
  "medrxiv.org",
  "biorxiv.org",
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
  "goodrx.com",
  "pharmacytimes.com",
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

export interface MinimumEvidenceEvaluation {
  eligible: boolean;
  trustedCount: number;
  highestTier: 1 | 2 | 3 | 4;
  reasonCode?: FailClosedReasonCode;
  evidenceCaveat?: string;
}

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
      const trackingKeys = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "ref",
        "fbclid",
        "gclid",
        "srsltid",
      ];
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

    // Default general web domain (treat as Tier 3 secondary reference)
    return { tier: 3, isAnecdotal: false };
  }

  /**
   * Deduplicates and ranks search results by clinical authority without aggressive discarding.
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
      // Tier 4 (anecdotal): 50 base
      let baseScore = 400;
      if (tier === 1) baseScore = 1000;
      else if (tier === 2) baseScore = 700;
      else if (tier === 4 || isAnecdotal) baseScore = 50;

      // Clinical relevance & temporal grounding bonuses
      let bonus = 0;
      const textToSearch = `${r.title} ${r.snippet || ""}`.toLowerCase();
      if (/clinicaltrials\.gov|nct\d{8}/i.test(textToSearch)) bonus += 220;
      if (/phase\s+(1|2|3|i|ii|iii)|randomized|double-blind|placebo/i.test(textToSearch)) bonus += 150;
      if (/fda approval|anvisa|ema|prescribing information|package insert/i.test(textToSearch)) bonus += 140;
      if (/peer-reviewed|journal|lancet|nejm|jama/i.test(textToSearch)) bonus += 100;

      // Temporal grounding from publishedAt or content year
      if (r.publishedAt) {
        if (/202[56]/i.test(r.publishedAt)) bonus += 160;
        else if (/2024/i.test(r.publishedAt)) bonus += 80;
      } else if (/202[56]/i.test(textToSearch)) {
        bonus += 90;
      }

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

    // Sort descending by authority score
    scored.sort((a, b) => b.score - a.score);

    // Re-index stable IDs S1, S2...
    return scored.slice(0, maxResults).map((item, idx) => ({
      ...item.result,
      id: `S${idx + 1}`,
    }));
  }

  /**
   * Minimum Evidence Policy:
   * Evaluates if ranked sources satisfy the clinical evidence threshold.
   */
  static evaluateMinimumEvidence(
    sources: SearchResult[],
    isClinicalSafetyQuery = false
  ): MinimumEvidenceEvaluation {
    if (!sources || sources.length === 0) {
      return {
        eligible: false,
        trustedCount: 0,
        highestTier: 4,
        reasonCode: "NO_NORMALIZED_RESULTS",
      };
    }

    const tier1Count = sources.filter((s) => s.tier === 1).length;
    const tier2Count = sources.filter((s) => s.tier === 2).length;
    const tier3Count = sources.filter((s) => s.tier === 3).length;
    const tier4Count = sources.filter((s) => s.tier === 4 || s.isAnecdotal).length;
    const trustedCount = tier1Count + tier2Count + tier3Count;

    // Highest tier present
    let highestTier: 1 | 2 | 3 | 4 = 4;
    if (tier1Count > 0) highestTier = 1;
    else if (tier2Count > 0) highestTier = 2;
    else if (tier3Count > 0) highestTier = 3;

    // Rule: If question is about clinical dosing/safety and only anecdotal Tier 4 sources exist:
    if (isClinicalSafetyQuery && trustedCount === 0 && tier4Count > 0) {
      return {
        eligible: false,
        trustedCount: 0,
        highestTier: 4,
        reasonCode: "INSUFFICIENT_EVIDENCE",
        evidenceCaveat: "Apenas fontes anedóticas (fóruns/redes) foram encontradas para uma consulta de segurança/dosagem clínica.",
      };
    }

    // Rule: At least 1 Tier 1 or Tier 2 or Tier 3
    if (trustedCount > 0) {
      let caveat: string | undefined;
      if (tier1Count === 0 && tier2Count > 0) {
        caveat = "Evidência baseada em centros acadêmicos e estudos secundários (Tier 2).";
      } else if (tier1Count === 0 && tier2Count === 0 && tier3Count > 0) {
        caveat = "Evidência informativa de referências secundárias de saúde (Tier 3).";
      }

      return {
        eligible: true,
        trustedCount,
        highestTier,
        evidenceCaveat: caveat,
      };
    }

    // If only Tier 4 exists for general factual query (non-safety)
    if (tier4Count > 0 && !isClinicalSafetyQuery) {
      return {
        eligible: true,
        trustedCount: 0,
        highestTier: 4,
        evidenceCaveat: "Aviso: Fontes consultadas são comunitárias/anedóticas.",
      };
    }

    return {
      eligible: false,
      trustedCount: 0,
      highestTier: 4,
      reasonCode: "NO_TRUSTED_RESULTS",
    };
  }
}
