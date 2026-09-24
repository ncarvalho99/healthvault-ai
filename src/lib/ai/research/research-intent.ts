import { ResearchIntentAnalysis, ResearchIntentType } from "./types";

// Common personal vault trigger phrases (Portuguese and English)
const LOCAL_VAULT_PATTERNS = [
  /\b(minha|meu|meus|minhas)\s+(dieta|peso|press[aã]o|glicemia|medicamento|rem[eé]dio|dose|exame|sintoma|registro|recomenda[cç][aã]o|hist[oó]rico)\b/i,
  /\bquais\s+(rem[eé]dios|medicamentos|exames|sintomas)\s+(eu\s+tomo|eu\s+tenho|est[aã]o\s+registrados)\b/i,
  /\b(adicione|adicionar|registre|registrar|salve|salvar|altere|alterar|atualize|atualizar|mude|mudar|remova|remover|exclua|excluir)\b.*\b(medicamento|rem[eé]dio|dose|dieta|caloria|peso|press[aã]o|sintoma)\b/i,
  /\b(o\s+que|quanto)\s+(eu\s+como|eu\s+tomo|eu\s+peso|registrei)\b/i,
  /\b(minha\s+rotina|minha\s+evolu[cç][aã]o|meu\s+progresso)\b/i,
];

// Clinical & external factual knowledge patterns
const EXTERNAL_FACT_PATTERNS = [
  /\b(guideline|diretriz|diretrizes|consenso|posologia|farmacocin[eé]tica|mecanismo\s+de\s+a[cç][aã]o)\b/i,
  /\b(interao|interage|interagir|rea[cç][aã]o\s+adversa|efeito\s+colateral|contraindica[cç][aã]o|toxicidade)\b/i,
  /\b(ensaio\s+cl[ií]nico|clinical\s+trial|estudo\s+cl[ií]nico|fase\s+[1234]|fase\s+iii|fase\s+ii)\b/i,
  /\b(aprova[cç][aã]o|aprovado|regulamenta[cç][aã]o)\s+(pela\s+|pelo\s+)?(anvisa|fda|ema|conitec)\b/i,
  /\b(retatrutide|slu-pp-332|mots-c|tirzepatide|semaglutide|ozempic|mounjaro|wegovy|zepbound|cagrilintide|survodutide|orforglipron)\b/i,
  /\b(pept[ií]deo|pept[ií]deos|sarm|nootr[oó]pico|composto\s+experimental|subst[aâ]ncia\s+experimental)\b/i,
  /\b(o\s+que\s+[eé]|como\s+funciona|para\s+que\s+serve|qual\s+a\s+fun[cç][aã]o\s+de)\b/i,
  /\b(qual\s+a\s+dose\s+recomendada|como\s+tomar|qual\s+o\s+protocolo\s+de\s+titula[cç][aã]o)\b/i,
  /\b(seguran[cç]a|efic[aá]cia|riscos|benef[ií]cios)\s+d[eo]\b/i,
];

// Explicit recency / latest information patterns
const RECENCY_PATTERNS = [
  /\b(recente|recentes|atual|atuais|[uú]ltim[oa]s?|not[ií]cias?|estudos?\s+de\s+202[456]|guidelines?\s+de\s+202[456]|novidades?)\b/i,
  /\b(em\s+202[56]|ano\s+atual|hoje\s+em\s+dia)\b/i,
  /\b(status\s+atual|panorama\s+atual)\b/i,
];

// Clinical entities extractor (peptides, GLP-1s, common drugs, metrics)
const ENTITY_REGEX = /\b(retatrutide|slu-pp-332|mots-c|tirzepatida|tirzepatide|semaglutida|semaglutide|ozempic|wegovy|mounjaro|zepbound|metformina|metformin|creatina|creatine|berberina|berberine|cagrilintide|bpc-157|tb-500|anvisa|fda|ema)\b/gi;

export class ResearchIntentAnalyzer {
  /**
   * Analyzes message intent to determine if Web Research is required.
   */
  static analyze(message: string, agentMode?: string): ResearchIntentAnalysis {
    const text = message.trim();
    if (!text) {
      return {
        intent: "LOCAL_VAULT_ONLY",
        requiresExternalResearch: false,
        suggestedQueries: [],
        entities: [],
        reason: "Empty query",
      };
    }

    // Extract clinical entities
    const entityMatches = text.match(ENTITY_REGEX) || [];
    const entities = Array.from(new Set(entityMatches.map((e) => e.toLowerCase())));

    // Check recency
    const hasRecency = RECENCY_PATTERNS.some((p) => p.test(text));

    // Check external medical knowledge
    const hasExternalKnowledge = EXTERNAL_FACT_PATTERNS.some((p) => p.test(text));

    // Check purely local vault
    const isLocalVault = LOCAL_VAULT_PATTERNS.some((p) => p.test(text));

    // Disambiguation
    let intent: ResearchIntentType = "LOCAL_VAULT_ONLY";
    let requiresExternalResearch = false;
    let reason = "General chat or personal vault inspection";

    if (isLocalVault && !hasExternalKnowledge) {
      // Personal vault queries ("qual minha dieta atual?", "meus remédios", "meu peso")
      intent = "LOCAL_VAULT_ONLY";
      requiresExternalResearch = false;
      reason = "Query targets personal health records, metrics, or current vault state";
    } else if (hasRecency && !isLocalVault) {
      intent = "CURRENT_INFORMATION";
      requiresExternalResearch = true;
      reason = "Query requests current or recently published clinical/scientific information";
    } else if (hasExternalKnowledge) {
      intent = "EXTERNAL_KNOWLEDGE";
      requiresExternalResearch = true;
      reason = "Query references medical guidelines, drug safety, trials, or experimental compounds";
    } else if (entities.length > 0 && !isLocalVault) {
      intent = "EXTERNAL_KNOWLEDGE";
      requiresExternalResearch = true;
      reason = `Query references specific clinical entity (${entities.join(", ")}) outside personal vault context`;
    } else if (isLocalVault && hasExternalKnowledge) {
      // Mixed: e.g. "minha dose de semaglutida está certa considerando o guideline da FDA?"
      intent = "EXTERNAL_KNOWLEDGE";
      requiresExternalResearch = true;
      reason = "Query combines personal vault context with external medical validation";
    }

    // Build concise, high-yield search queries
    const suggestedQueries = this.buildSearchQueries(text, entities, intent);

    return {
      intent,
      requiresExternalResearch,
      suggestedQueries,
      entities,
      reason,
    };
  }

  private static buildSearchQueries(text: string, entities: string[], intent: ResearchIntentType): string[] {
    const queries: string[] = [];
    const currentYear = new Date().getFullYear();

    if (entities.length > 0) {
      const primaryEntity = entities[0];
      // Target clinical / trial query
      if (primaryEntity.includes("retatrutide") || primaryEntity.includes("slu-pp-332") || primaryEntity.includes("mots-c")) {
        queries.push(`${primaryEntity} clinical trials FDA status ${currentYear}`);
        queries.push(`${primaryEntity} human dosing trial results peer reviewed`);
      } else {
        queries.push(`${primaryEntity} clinical guidelines safety dosage`);
      }
    } else if (intent === "CURRENT_INFORMATION" || intent === "EXTERNAL_KNOWLEDGE") {
      // Clean query text for search engine
      const cleaned = text
        .replace(/[?.,!;]/g, "")
        .replace(/\b(qual|quais|como|quando|onde|por que|o que|sobre|me diga|explique)\b/gi, "")
        .trim();
      if (cleaned.length > 5) {
        queries.push(`${cleaned} ${currentYear}`);
      }
    }

    return queries.slice(0, 3);
  }
}
