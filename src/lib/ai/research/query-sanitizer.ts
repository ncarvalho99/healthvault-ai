/**
 * Privacy-Preserving Web Search Query Sanitizer & Concept Minimizer
 *
 * Enforces server-side PII redaction and clinical query minimization before
 * any string is transmitted to external search providers (Firecrawl, Ollama Search, SearXNG, Brave).
 */

const PII_PATTERNS = [
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  // Phone numbers (international and national formats)
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,5}[-.\s]?\d{4}/g,
  // UUIDs / database identifiers
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // Physical address markers
  /\b(?:rua|av\.|avenida|alameda|travessa|bairro|apto|cep)\b[^,.;]*/gi,
  // Personal introductions / names
  /\b(?:meu nome [eé]|sou o|sou a|me chamo|i am|my name is)\s+[a-zA-ZÀ-ÿ]+/gi,
];

// Personal narrative clauses to remove from web queries
const PERSONAL_NARRATIVE_PATTERNS = [
  /\b(eu uso|eu tomo|estou usando|estou tomando|comecei a usar|comecei a tomar|meu médico|me receitou|eu tive|eu sinto|minha dose|minha dieta|meu peso|minha rotina|meus exames)\b/gi,
  /\b(i take|i use|i am taking|i have|my doctor|prescribed me|my dose|my diet|my weight|i felt|i experienced)\b/gi,
  /\b(depois de|após|quando|desde que|há \d+ dias|há \d+ semanas)\b/gi,
];

// Common symptoms / conditions to preserve during clinical minimization
const CLINICAL_SYMPTOM_MAP: Record<string, string> = {
  "nausea": "nausea",
  "náusea": "nausea",
  "vomiting": "vomiting",
  "vômito": "vomiting",
  "vomito": "vomiting",
  "reflux": "reflux",
  "refluxo": "reflux",
  "headache": "headache",
  "dor de cabeça": "headache",
  "cefaleia": "headache",
  "diarrhea": "diarrhea",
  "diarreia": "diarrhea",
  "constipation": "constipation",
  "constipação": "constipation",
  "fatigue": "fatigue",
  "fadiga": "fatigue",
  "hipoglicemia": "hypoglycemia",
  "hypoglycemia": "hypoglycemia",
  "tontura": "dizziness",
  "dizziness": "dizziness",
};

// Intent focus keywords
const FOCUS_KEYWORDS: Record<string, string> = {
  "guideline": "clinical guideline",
  "guidelines": "clinical guidelines",
  "diretriz": "clinical guideline",
  "diretrizes": "clinical guidelines",
  "posologia": "dosage guidelines",
  "dose": "dosage",
  "dosagem": "dosage",
  "interação": "drug interaction",
  "interacao": "drug interaction",
  "interaction": "drug interaction",
  "segurança": "safety",
  "seguranca": "safety",
  "safety": "safety",
  "ensaio clínico": "clinical trial",
  "ensaios clínicos": "clinical trials",
  "clinical trial": "clinical trial",
  "clinical trials": "clinical trials",
  "fda": "FDA",
  "anvisa": "ANVISA",
  "ema": "EMA",
};

export class QuerySanitizer {
  /**
   * Redacts any PII (names, emails, phones, IDs, addresses) from input string.
   */
  static redactPII(input: string): string {
    if (!input) return "";
    let clean = input;
    for (const pattern of PII_PATTERNS) {
      clean = clean.replace(pattern, " ");
    }
    return clean.replace(/\s+/g, " ").trim();
  }

  /**
   * Sanitizes and minimizes a user clinical query before transmission to search engines.
   * Strips personal narratives, PII, and extracts only essential concepts:
   * [entity] [condition/effect] [focus/guideline] [recency/authority]
   *
   * Example: "Eu uso semaglutida e tive náusea depois de comer; qual guideline recente?"
   * -> "semaglutide nausea clinical guideline current"
   */
  static sanitizeAndMinimize(rawQuery: string): string {
    if (!rawQuery) return "";

    // 1. Redact PII first
    const sanitized = this.redactPII(rawQuery);
    const lower = sanitized.toLowerCase();

    // 2. Extract clinical entities if present
    const entityMatches = lower.match(
      /\b(retatrutide|retatrutida|tirzepatide|tirzepatida|semaglutide|semaglutida|ozempic|wegovy|mounjaro|zepbound|metformin|metformina|creatine|creatina|berberine|berberina|cagrilintide|bpc-157|tb-500|slu-pp-332|mots-c)\b/gi
    ) || [];

    const entities = Array.from(
      new Set(
        entityMatches.map((e) => {
          const l = e.toLowerCase();
          if (l === "retatrutida") return "retatrutide";
          if (l === "tirzepatida") return "tirzepatide";
          if (l === "semaglutida") return "semaglutide";
          if (l === "metformina") return "metformin";
          if (l === "creatina") return "creatine";
          if (l === "berberina") return "berberine";
          return l;
        })
      )
    );

    // 3. Extract symptoms / conditions
    const symptoms: string[] = [];
    for (const [key, normalized] of Object.entries(CLINICAL_SYMPTOM_MAP)) {
      if (lower.includes(key) && !symptoms.includes(normalized)) {
        symptoms.push(normalized);
      }
    }

    // 4. Extract focus terms
    const focusTerms: string[] = [];
    for (const [key, term] of Object.entries(FOCUS_KEYWORDS)) {
      if (lower.includes(key) && !focusTerms.includes(term)) {
        focusTerms.push(term);
      }
    }

    // 5. Check recency
    const hasRecency = /\b(recente|recentes|atual|atuais|202[56]|current|latest)\b/i.test(lower);
    const recencyTerm = hasRecency ? "current" : "";

    // 6. If structured clinical concepts were extracted, synthesize minimal query
    if (entities.length > 0) {
      const parts = [
        entities.join(" "),
        symptoms.slice(0, 2).join(" "),
        focusTerms.slice(0, 2).join(" "),
        recencyTerm,
      ].filter((p) => p.length > 0);

      // If domain site syntax exists in raw query, preserve it
      const siteMatch = rawQuery.match(/site:[a-z0-9.-]+/i);
      if (siteMatch) {
        parts.unshift(siteMatch[0]);
      }

      return parts.join(" ").replace(/\s+/g, " ").trim();
    }

    // 7. General query without known entities: strip personal narrative and filler
    let generalClean = sanitized;
    for (const p of PERSONAL_NARRATIVE_PATTERNS) {
      generalClean = generalClean.replace(p, " ");
    }

    generalClean = generalClean
      .replace(/[?.,!;]/g, "")
      .replace(/\b(qual|quais|como|quando|onde|por que|o que|sobre|me diga|explique|sobre isso|ola|olá|bom dia|boa tarde|por favor)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    return generalClean.slice(0, 100);
  }
}
