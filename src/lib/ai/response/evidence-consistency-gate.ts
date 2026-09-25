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
   * Separates Web-dependent checks (requiring sources) and Web-independent checks (Vault state & internal consistency).
   */
  static evaluate(options: ConsistencyGateOptions): ConsistencyGateResult {
    const { userMessage, assistantText, sources = [], vaultContextBlock = "" } = options;
    const violations: string[] = [];
    const lowerText = assistantText.toLowerCase();

    // ==========================================
    // 1. CHECKS DEPENDENT ON WEB RESEARCH (sources.length > 0)
    // ==========================================
    if (sources.length > 0) {
      const sourcesText = sources
        .map((s) => `${s.title} ${s.snippet || ""}`)
        .join(" ")
        .toLowerCase();

      // 1.1 Lazy Conversational Repetition Check
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

      // 1.2 Contradicts Source Context (e.g. trial results reported vs claims of no results)
      const sourcesHaveTrialResults =
        /\b(phase\s*3|fase\s*3|trial|ensaio|estudo|triumph)\b/i.test(sourcesText) &&
        /\b(results|reported|efficacy|published|demonstrated|conclu[ií]d[oa]|resultados|apresentou|demonstrou)\b/i.test(sourcesText);

      if (sourcesHaveTrialResults) {
        const claimsNoTrialResults =
          /\b(fase\s*3|phase\s*3|ensaio|estudo|trial)\b[^\n.!?]*\b(ainda\s+est[aãá]o?\s+em\s+andamento|sem\s+resultados|n[aã]o\s+(h[aá]|foram|possui|teve)\s+resultados)\b/i.test(
            lowerText
          ) ||
          /\b(sem\s+dados\s+de\s+fase\s*3|n[aã]o\s+h[aá]\s+dados\s+de\s+fase\s*3|no\s+phase\s*3\s+data)\b/i.test(lowerText);

        if (claimsNoTrialResults) {
          violations.push(
            "CONTRADICTS_SOURCE_CONTEXT: Assistant asserted clinical trial has no published results, directly contradicting provided source evidence."
          );
        }
      }

      // 1.3 Cross-Product Dosing Contamination Grounded in Sources
      // Check if sources distinguish products (e.g. Wegovy vs Ozempic) and associate specific dose steps
      const clauses = assistantText.split(/[;!?]|\.\s+/);
      for (const clause of clauses) {
        const lowerClause = clause.toLowerCase();
        const doseRegex = /\b(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g))\b/gi;
        const clauseDoses = Array.from(lowerClause.matchAll(doseRegex)).map((m) => m[1]);

        if (clauseDoses.length > 0) {
          if (
            sourcesText.includes("wegovy") &&
            sourcesText.includes("ozempic") &&
            lowerClause.includes("ozempic") &&
            !lowerClause.includes("wegovy")
          ) {
            for (const d of clauseDoses) {
              const normalizedD = d.replace(/\s+/g, "\\s*");
              const wegovyDosePattern = new RegExp(`wegovy[^.]*?${normalizedD}|${normalizedD}[^.]*?wegovy`, "i");
              const exclusivePattern = new RegExp(
                `(?:exclusive|exclusiv[ao]|pertence|apenas|only)[^.]*?${normalizedD}|${normalizedD}[^.]*?(?:exclusive|exclusiv[ao]|pertence|apenas|only)`,
                "i"
              );
              if (wegovyDosePattern.test(sourcesText) && (exclusivePattern.test(sourcesText) || /1[.,]7\s*mg/i.test(d))) {
                violations.push(
                  `CROSS_PRODUCT_DOSING_CONTAMINATION: Assistant attributed dose ${d} to Ozempic in contradiction to source evidence distinguishing Wegovy and Ozempic.`
                );
                break;
              }
            }
          }
        }
      }
    }

    // ==========================================
    // 2. CHECKS INDEPENDENT OF WEB RESEARCH (Run even when Research=SKIPPED)
    // ==========================================

    // 2.1 Mutually Incompatible Claims (Internal logical contradiction)
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

    // 2.2 Stale Conversational History vs Current Structured Vault State
    if (vaultContextBlock) {
      const activeMedsMatch = vaultContextBlock.match(/Active Medications:\s*([^\n<]+)/i);
      const medsSummary = activeMedsMatch ? activeMedsMatch[1] : vaultContextBlock;

      if (!/none registered|no active medications/i.test(medsSummary)) {
        const doseMatches = medsSummary.matchAll(/([A-Za-zÀ-ÿ\s]+)\s*\(\s*([^,]+?)(?:,\s*[^,]+?)*,\s*v?\d+\s*\)/g);
        let flagged = false;
        for (const match of doseMatches) {
          const medName = match[1].trim().toLowerCase();
          const dose = match[2].trim().toLowerCase();
          const escapedDose = dose.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
          const escapedMed = medName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

          const claimsPending = new RegExp(
            `\\b(?:dose\\s+de\\s+${escapedDose}|${escapedMed}\\s+de\\s+${escapedDose}|${escapedDose})\\s+(?:est[aá]\\s+pendente|aguarda\\s+aprova[cç][aã]o|ainda\\s+n[aã]o\\s+foi\\s+aprovad[ao]|pendente\\s+de\\s+aprova[cç][aã]o|proposta\\s+de\\s+${escapedDose}\\s+pendente)`,
            "i"
          );

          if (claimsPending.test(assistantText)) {
            violations.push(
              `STALE_PROSE_VS_VAULT: Assistant referred to a dose change as 'pending' based on past conversation history, but HealthVault structured data shows '${match[1].trim()} ${match[2].trim()}' is already active.`
            );
            flagged = true;
            break;
          }
        }

        if (
          !flagged &&
          /semaglutid[ae][^;]*2(\.0)?\s*mg/i.test(vaultContextBlock) &&
          /\b(dose\s+de\s+2\s*mg\s+(est[aá]\s+pendente|aguarda\s+aprova[cç][aã]o|ainda\s+n[aã]o\s+foi\s+aprovada)|proposta\s+de\s+2\s*mg\s+pendente)\b/i.test(
            lowerText
          )
        ) {
          violations.push(
            "STALE_PROSE_VS_VAULT: Assistant referred to a dose change as 'pending' based on past conversation history, but HealthVault structured data shows the dose is already active."
          );
        }
      }

      // 2.3 Stale Active Medication Claim (Generic active vs discontinued reconciliation)
      const isMedsEmpty = /none registered|no active medications/i.test(medsSummary);
      if (isMedsEmpty) {
        const claimsActiveMedication =
          /\b(j[aá]\s+(?:em\s+uso|ativa|ativo|est[aá]\s+ativo)|continua\b|continue\s+com|mantenha\s+o|mant[eé]m|dose\s+atual\s+(?:de\s+)?\d+)\b/i.test(
            lowerText
          ) ||
          /\b(medicamento\s+atual|seu\s+medicamento\s+ativo)\b/i.test(lowerText);

        if (claimsActiveMedication) {
          violations.push(
            "STALE_ACTIVE_MEDICATION_CLAIM: Assistant claimed a medication is currently active or in use, but HealthVault structured data confirms there are NO active medications registered."
          );
        }
      } else {
        const claimsNoMeds =
          /\b(nenhum\s+medicamento\s+ativo|n[aã]o\s+possui\s+medicamentos|n[aã]o\s+h[aá]\s+medicamentos\s+cadastrados|no\s+active\s+medications)\b/i.test(
            lowerText
          );
        if (claimsNoMeds) {
          violations.push(
            "STALE_ACTIVE_MEDICATION_CLAIM: Assistant asserted that no active medications exist, contradicting active medications registered in HealthVault."
          );
        }
      }
    }

    const isValid = violations.length === 0;

    let remediationPrompt: string | undefined = undefined;
    if (!isValid) {
      remediationPrompt = `Please regenerate your response to correct these clinical consistency issues:
${violations.map((v) => `- ${v}`).join("\n")}

Guidelines:
1. Synthesize directly from <web_research> and <healthvault_data>.
2. Do not refer to past turns ("já cobrimos", "conforme dito acima", "veja acima").
3. Current structured HealthVault data is authoritative over conversational history.
4. If no active medications are registered in HealthVault, state that plainly; do not claim old or discontinued medications are active.
5. For clinical and regulatory claims, follow current <web_research> evidence and distinguish products, indications, and jurisdictions accurately without mixing distinct products.`;
    }

    return {
      isValid,
      violations,
      remediationPrompt,
    };
  }
}
