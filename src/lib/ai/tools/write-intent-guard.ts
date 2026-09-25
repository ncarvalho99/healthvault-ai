/**
 * WriteIntentGuard
 *
 * Deterministic server-side guard that distinguishes advisory/generative requests
 * from persistent mutation intent, enforcing confirmation binding and persisting
 * baseline conflicts across dialogue turns.
 */

export interface WriteIntentCheckOptions {
  userMessage?: string;
  previousAssistantMessage?: string;
  previousUserMessage?: string;
  conversationHistory?: Array<{ role: string; content?: string | null }>;
  toolName: string;
  toolAccess?: string;
  toolCategory?: string;
  vaultWeightKg?: number | null;
}

export interface WriteIntentCheckResult {
  allowed: boolean;
  intent: "EXPLICIT_MUTATION" | "CONFIRMATION" | "ADVISORY" | "BASELINE_CONFLICT" | "NO_WRITE_INTENT";
  reason?: string;
}

const ADVISORY_PATTERNS = [
  /\b(monte|montar|crie\s+uma\s+sugest[aã]o|sugira|sugerir|sugest[aã]o\s+de|recomende|recomendar|recomenda[cç][aã]o|quais\s+op[cç][oõ]es|qual\s+protocolo|ideias\s+de|o\s+que\s+voc[eê]\s+acha|como\s+seria|calcule|calcular|simule|simular|proponha|propor|op[cç][oõ]es\s+de|dicas\s+de)\b/i,
  /\b(suggest|recommend|propose|calculate|simulate|what\s+do\s+you\s+think|ideas\s+for|how\s+would)\b/i,
];

const EXPLICIT_MUTATION_PATTERNS = [
  /\b(registre|registrar|grave|gravar|salve|salvar|adicione|adicionar|atualize|atualizar|altere|alterar|modifique|modificar|mude|mudar|troque|trocar|pare|parar|suspenda|suspender|descontinue|descontinuar|interrompa|interromper|aplique|aplicar|cadastre|cadastrar|defina|definir|coloque|colocar|insira|inserir|delete|deletar|exclua|excluir|remova|remover|anote|anotar|guarde|guardar)\b/i,
  /\b(save|record|update|change|stop|discontinue|apply|set|add|register|delete|remove|modify)\b/i,
  /\b(minha\s+nova\s+dieta\s+[eé]|meu\s+novo\s+peso\s+[eé]|nova\s+dose\s+[eé]|quero\s+salvar|pode\s+salvar|pode\s+gravar|pode\s+registrar|pode\s+atualizar|por\s+favor\s+salve)\b/i,
  /\b(sim,\s*(salve|grave|registre|atualize|pode\s+salvar|aplique))\b/i,
];

const GENERIC_AFFIRMATIVE_PATTERNS = [
  /^(sim|ok|pode|confirmo|confirmar|quero|com\s+certeza|fa[cç]a\s+isso|yes|confirm|go\s+ahead)[\s.!,]*$/i,
];

const PREVIOUS_ASSISTANT_OFFER_SAVE_PATTERNS = [
  /(?:quer\s+que\s+eu|deseja\s+que\s+eu|posso|gostaria\s+que\s+eu)\s+(?:salve|salvar|registre|registrar|grave|gravar|aplique|aplicar|atualize|atualizar)/i,
  /(?:salvar|gravar|registrar|aplicar)\s+(?:este|esse|o)\s+plano/i,
  /(?:would\s+you\s+like\s+me\s+to|should\s+I)\s+(?:save|record|apply|register)/i,
];

function findDialogueReportedWeight(
  userMessage: string,
  previousUserMessage?: string,
  previousAssistantMessage?: string,
  history?: Array<{ role: string; content?: string | null }>
): number | null {
  // 1. Current user message
  const matchCurrent =
    userMessage.match(/\b(?:estou\s+com|peso\s+(?:de\s+)?|pesando\s+|com\s+)(\d+(?:[.,]\d+)?)\s*kg\b/i) ||
    userMessage.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (matchCurrent) {
    const val = parseFloat(matchCurrent[1].replace(",", "."));
    if (!isNaN(val)) return val;
  }

  // 2. Previous user message
  if (previousUserMessage) {
    const matchPrev =
      previousUserMessage.match(/\b(?:estou\s+com|peso\s+(?:de\s+)?|pesando\s+|com\s+)(\d+(?:[.,]\d+)?)\s*kg\b/i) ||
      previousUserMessage.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i);
    if (matchPrev) {
      const val = parseFloat(matchPrev[1].replace(",", "."));
      if (!isNaN(val)) return val;
    }
  }

  // 3. Previous assistant message referencing reported weight
  if (previousAssistantMessage) {
    const matchAssist = previousAssistantMessage.match(/\b(?:mencionou|informou|disse)\s+(\d+(?:[.,]\d+)?)\s*kg/i);
    if (matchAssist) {
      const val = parseFloat(matchAssist[1].replace(",", "."));
      if (!isNaN(val)) return val;
    }
  }

  // 4. History
  if (history && history.length > 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === "user" && msg.content) {
        const m =
          msg.content.match(/\b(?:estou\s+com|peso\s+(?:de\s+)?|pesando\s+|com\s+)(\d+(?:[.,]\d+)?)\s*kg\b/i) ||
          msg.content.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i);
        if (m) {
          const val = parseFloat(m[1].replace(",", "."));
          if (!isNaN(val)) return val;
        }
      }
    }
  }

  return null;
}

export class WriteIntentGuard {
  /**
   * Determines whether an incoming tool execution is authorized by the user's intent.
   * Read tools are always allowed. Write tools require explicit mutation intent or valid confirmation.
   */
  static check(options: WriteIntentCheckOptions): WriteIntentCheckResult {
    const {
      userMessage,
      previousAssistantMessage = "",
      previousUserMessage,
      conversationHistory,
      toolName,
      toolAccess,
      vaultWeightKg,
    } = options;

    // 1. Read tools never require write intent
    if (toolAccess === "read") {
      return { allowed: true, intent: "EXPLICIT_MUTATION" };
    }

    // 1.5 If userMessage is not provided, caller is a direct internal dispatch (e.g. unit tests of dispatcher/approval)
    if (userMessage === undefined || userMessage === null) {
      return { allowed: true, intent: "EXPLICIT_MUTATION" };
    }

    const trimmedUser = userMessage.trim();
    if (!trimmedUser) {
      return {
        allowed: false,
        intent: "NO_WRITE_INTENT",
        reason: "WRITE_INTENT_REQUIRED: Mensagem vazia não autoriza gravação persistente no HealthVault.",
      };
    }

    // 2. Check for Material Baseline Conflict in Weight across turns
    // If user self-reported a weight that materially differs from Vault (> 4 kg), and tool is diet/recommendation write:
    if (
      typeof vaultWeightKg === "number" &&
      vaultWeightKg > 0 &&
      (toolName.includes("diet") || toolName.includes("recommendation"))
    ) {
      const reportedWeight = findDialogueReportedWeight(
        trimmedUser,
        previousUserMessage,
        previousAssistantMessage,
        conversationHistory
      );

      if (reportedWeight !== null && Math.abs(reportedWeight - vaultWeightKg) >= 4.0) {
        // Did user explicitly instruct to resolve/register this weight?
        // e.g. "sim, considere 98 kg como meu peso atual e registre isso", "atualize meu peso para 98 kg"
        const explicitlyResolvingWeight =
          /(?:considere\s+\d+|atualiz\w*|mud\w*|alter\w*|registr\w*|salv\w*)\s+(?:meu\s+)?peso/i.test(trimmedUser) ||
          /(?:considere\s+\d+\s*kg.*?(?:peso|registre|salve))/i.test(trimmedUser);

        if (!explicitlyResolvingWeight) {
          return {
            allowed: false,
            intent: "BASELINE_CONFLICT",
            reason: `BASELINE_CONFLICT: Conflito material entre o peso informado no diálogo (${reportedWeight} kg) e o último peso registrado no HealthVault (${vaultWeightKg} kg) ainda não foi resolvido. Confirme explicitamente a atualização do peso no prontuário (ex: 'sim, considere ${reportedWeight} kg como meu peso atual e registre isso') antes de persistir dieta ou recomendação.`,
          };
        }
      }
    }

    // 3. Check for Generic Affirmative Confirmation (sim, ok, pode, confirmo)
    const isGenericAffirmative = GENERIC_AFFIRMATIVE_PATTERNS.some((p) => p.test(trimmedUser));
    const previousOfferedSave = PREVIOUS_ASSISTANT_OFFER_SAVE_PATTERNS.some((p) =>
      p.test(previousAssistantMessage)
    );

    if (isGenericAffirmative) {
      if (previousOfferedSave) {
        return { allowed: true, intent: "CONFIRMATION" };
      } else {
        return {
          allowed: false,
          intent: "NO_WRITE_INTENT",
          reason: `WRITE_INTENT_REQUIRED: Resposta afirmativa genérica ('${trimmedUser}') sem oferta prévia de persistência no HealthVault não autoriza gravação persistente.`,
        };
      }
    }

    // 4. Check explicit mutation intent (salve, registre, atualize, mude, pare, etc.)
    const hasExplicitMutation = EXPLICIT_MUTATION_PATTERNS.some((p) => p.test(trimmedUser));
    const hasAdvisory = ADVISORY_PATTERNS.some((p) => p.test(trimmedUser));

    // If explicit mutation directive is present:
    if (hasExplicitMutation) {
      return { allowed: true, intent: "EXPLICIT_MUTATION" };
    }

    // If user request is advisory/generative (e.g. "monte uma dieta...", "recomende opções..."):
    if (hasAdvisory) {
      return {
        allowed: false,
        intent: "ADVISORY",
        reason:
          "WRITE_INTENT_REQUIRED: A solicitação atual é consultiva/propositiva ('monte/recomende/sugira') e não expressa comando explícito de gravação ('salve', 'registre', 'atualize no vault'). Apresente a recomendação/plano ao usuário e pergunte se ele deseja salvar/aplicar essas alterações no prontuário.",
      };
    }

    // Default: write operations require clear intent
    return {
      allowed: false,
      intent: "NO_WRITE_INTENT",
      reason:
        "WRITE_INTENT_REQUIRED: Nenhuma intenção explícita de mutação persistente foi detectada na mensagem do usuário. Apresente a resposta consultivamente e solicite confirmação antes de gravar no HealthVault.",
    };
  }
}
