import { SearchResult } from "../research/types";

export interface ConsistencyGateOptions {
  userMessage: string;
  assistantText: string;
  sources?: SearchResult[];
  vaultContextBlock?: string;
  conversationHistory?: Array<{
    role: string;
    content: string;
  }>;
}

export interface ConsistencyGateResult {
  isValid: boolean;
  violations: string[];
  remediationPrompt?: string;
}

const LAZY_REFERENCE_PATTERNS = [
  /\b(j[aá]\s+(respond\w*|cobri\w*|fala\w*|menciona\w*|diss\w*)|conforme\s+(dito|mencionado|respondido)\s+acima|resposta\s+est[aá]\s+acima|mesma\s+pergunta|mesma\s+resposta|nada\s+mudou|j[aá]\s+vimos)\b/i,
  /\b(as\s+mentioned\s+above|already\s+answered|already\s+covered|see\s+above|nothing\s+has\s+changed|same\s+answer)\b/i,
];

export class EvidenceConsistencyGate {
  /**
   * Deterministic consistency check for clinical assistant responses grounded in Web Research and HealthVault state.
   */
  static evaluate(options: ConsistencyGateOptions): ConsistencyGateResult {
    const { userMessage, assistantText, sources = [], vaultContextBlock = "" } = options;
    const violations: string[] = [];
    const lowerText = assistantText.toLowerCase();

    // 1. Lazy Conversational Repetition Check (when fresh sources exist)
    if (sources.length > 0) {
      const isLazy = LAZY_REFERENCE_PATTERNS.some((p) => p.test(assistantText));
      if (
        isLazy &&
        (assistantText.length < 350 ||
          /\b(mesma\s+resposta|nada\s+mudou|resposta\s+est[aá]\s+acima|j[aá]\s+respondido\s+acima)\b/i.test(assistantText))
      ) {
        violations.push(
          "LAZY_REPETITION_REFERENCE: Assistant deflected current inquiry by referring to previous chat turns instead of synthesizing current <web_research> sources."
        );
      }
    }

    // 2. Contradicts Source Context (e.g. Phase 3 trial results reported vs claims of no results)
    if (sources.length > 0) {
      const sourcesText = sources
        .map((s) => `${s.title} ${s.snippet || ""}`)
        .join(" ")
        .toLowerCase();

      // Check Retatrutide Phase 3 milestone: sources indicate TRIUMPH / results reported in 2026
      const sourcesHavePhase3Results =
        /\b(triumph|phase\s*3|fase\s*3)\b/i.test(sourcesText) &&
        /\b(results|reported|efficacy|published|demonstrated|conclu[ií]d[oa]|resultados)\b/i.test(sourcesText);

      if (sourcesHavePhase3Results) {
        const claimsNoPhase3Results =
          /\b(fase\s*3|phase\s*3)\b[^\n.!?]*\b(ainda\s+est[aãá]o?\s+em\s+andamento|sem\s+resultados|n[aã]o\s+(h[aá]|foram|possui|teve)\s+resultados)\b/i.test(
            lowerText
          ) ||
          /\b(sem\s+dados\s+de\s+fase\s*3|n[aã]o\s+h[aá]\s+dados\s+de\s+fase\s*3)\b/i.test(lowerText);

        if (claimsNoPhase3Results) {
          violations.push(
            "CONTRADICTS_SOURCE_CONTEXT: Assistant asserted Phase 3 has no published results, directly contradicting provided 2026 trial evidence."
          );
        }
      }
    }

    // 3. Mutually Incompatible Claims (e.g. 'not approved for any indication' vs 'approved for diabetes/Ozempic')
    const claimsNotApprovedForAny =
      /\b(n[aã]o\s+[eé]\s+aprovad[ao]\s+para\s+nenhuma\s+indica[cç][aã]o|not\s+approved\s+for\s+any\s+indication|n[aã]o\s+possui\s+aprova[cç][aã]o\s+para\s+nenhum\s+uso)\b/i.test(
        lowerText
      );

    const claimsApprovedSpecific =
      /\b(aprovad[ao]\s+pela\s+(fda|anvisa|ema)|fda-approved|aprovad[ao]\s+para\s+(diabetes|dm2|obesidade))\b/i.test(
        lowerText
      );

    if (claimsNotApprovedForAny && claimsApprovedSpecific) {
      violations.push(
        "MUTUALLY_INCOMPATIBLE_CLAIMS: Response contains contradictory statements claiming a dose or substance is 'not approved for any indication' while also claiming approval."
      );
    }

    // 4. Cross-Product Dosing Contamination
    // Ozempic is for T2D (0.25 -> 0.5 -> 1.0 -> 2.0 mg max). 1.7 mg is exclusive to Wegovy.
    const clauses = assistantText.split(/[;!?]|\.\s+/);
    for (const clause of clauses) {
      const lowerClause = clause.toLowerCase();
      if (lowerClause.includes("ozempic") && !lowerClause.includes("wegovy")) {
        if (/\b1[.,]7\s*mg\b/i.test(lowerClause)) {
          violations.push(
            "CROSS_PRODUCT_DOSING_CONTAMINATION: Ozempic titration/dosing contaminated with Wegovy-exclusive 1.7 mg step. Ozempic (T2D) titrates 0.25 -> 0.5 -> 1.0 -> 2.0 mg max; 1.7 mg is exclusive to Wegovy."
          );
          break;
        }
      }
    }

    // 5. Stale Conversational History vs Current Structured Vault State
    if (vaultContextBlock) {
      // Check if Vault shows an active medication dose (e.g. Semaglutida 2 mg active)
      const sema2mgActiveInVault =
        /semaglutid[ae][^;]*2(\.0)?\s*mg/i.test(vaultContextBlock) &&
        !/none registered/i.test(vaultContextBlock);

      if (sema2mgActiveInVault) {
        const claimsSema2mgPending =
          /\b(dose\s+de\s+2\s*mg\s+(est[aá]\s+pendente|aguarda\s+aprova[cç][aã]o|ainda\s+n[aã]o\s+foi\s+aprovada)|proposta\s+de\s+2\s*mg\s+pendente)\b/i.test(
            lowerText
          );

        if (claimsSema2mgPending) {
          violations.push(
            "STALE_PROSE_VS_VAULT: Assistant referred to a dose change as 'pending' based on past conversation history, but HealthVault structured data shows the dose is already active."
          );
        }
      }
    }

    const isValid = violations.length === 0;

    let remediationPrompt: string | undefined = undefined;
    if (!isValid) {
      remediationPrompt = `Please regenerate your response to correct these clinical issues:
${violations.map((v) => `- ${v}`).join("\n")}

Guidelines:
1. Synthesize directly from <web_research> and <healthvault_data>.
2. Never dismiss the question as already answered. Fresh evidence always requires an updated synthesis.
3. Keep product indications distinct (Ozempic for T2D up to 2.0 mg; Wegovy for obesity up to 2.4 mg with 1.7 mg step). Never mix dosing across products.
4. Current structured Vault state overrides past conversational history.`;
    }

    return {
      isValid,
      violations,
      remediationPrompt,
    };
  }
}
