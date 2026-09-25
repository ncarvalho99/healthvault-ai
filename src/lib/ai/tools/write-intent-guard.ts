/**
 * WriteIntentGuard
 *
 * Deterministic server-side guard that distinguishes advisory/generative requests
 * from persistent mutation intent, preventing accidental database mutations
 * on prompts like "monte uma dieta...", "recomende opções...", etc.
 */

export interface WriteIntentCheckOptions {
  userMessage?: string;
  previousAssistantMessage?: string;
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
  /\b(minha\s+nova\s+dieta\s+[eé]|meu\s+novo\s+peso\s+[eé]|nova\s+dose\s+[eé]|quero\s+salvar|pode\s+salvar|pode\s+gravar|por\s+favor\s+salve)\b/i,
];

const CONFIRMATION_PATTERNS = [
  /^(sim|pode|pode\s+salvar|pode\s+gravar|pode\s+registrar|pode\s+atualizar|pode\s+aplicar|salve|grave|registre|confirmo|confirmar|quero|quero\s+salvar|ok,\s*salve|por\s+favor\s*salve|com\s+certeza|fa[cç]a\s+isso|yes|confirm|please\s+save|go\s+ahead)[\s.!,]*$/i,
  /\b(sim,\s*(salve|grave|registre|atualize|pode\s+salvar|aplique))\b/i,
];

const PREVIOUS_ASSISTANT_OFFER_SAVE_PATTERNS = [
  /(?:quer\s+que\s+eu|deseja\s+que\s+eu|posso|gostaria\s+que\s+eu)\s+(?:salve|salvar|registre|registrar|grave|gravar|aplique|aplicar|atualize|atualizar)/i,
  /(?:salvar|gravar|registrar|aplicar)\s+(?:este|esse|o)\s+plano/i,
  /(?:would\s+you\s+like\s+me\s+to|should\s+I)\s+(?:save|record|apply|register)/i,
];

export class WriteIntentGuard {
  /**
   * Determines whether an incoming tool execution is authorized by the user's intent.
   * Read tools are always allowed. Write tools require explicit mutation intent or valid confirmation.
   */
  static check(options: WriteIntentCheckOptions): WriteIntentCheckResult {
    const {
      userMessage,
      previousAssistantMessage = "",
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

    // 2. Check confirmation to a previous assistant offer to save/persist
    const isConfirmation = CONFIRMATION_PATTERNS.some((p) => p.test(trimmedUser));
    const previousOfferedSave = PREVIOUS_ASSISTANT_OFFER_SAVE_PATTERNS.some((p) =>
      p.test(previousAssistantMessage)
    );

    if (isConfirmation || (previousOfferedSave && /^(sim|pode|ok|confirmo|quero)[\s.!,]*$/i.test(trimmedUser))) {
      return { allowed: true, intent: "CONFIRMATION" };
    }

    // 3. Check for Material Baseline Conflict in Weight
    // If user self-reported a weight that materially differs from Vault (> 4 kg), and tool is diet/recommendation write:
    if (
      typeof vaultWeightKg === "number" &&
      vaultWeightKg > 0 &&
      (toolName.includes("diet") || toolName.includes("recommendation"))
    ) {
      const weightMatch = trimmedUser.match(/\b(?:estou\s+com|peso\s+(?:de\s+)?|pesando\s+|com\s+)(\d+(?:[.,]\d+)?)\s*kg\b/i) ||
                          trimmedUser.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i);

      if (weightMatch) {
        const reportedWeight = parseFloat(weightMatch[1].replace(",", "."));
        if (!isNaN(reportedWeight) && Math.abs(reportedWeight - vaultWeightKg) >= 4.0) {
          // If the user did NOT explicitly instruct to update weight ("atualize meu peso para X"),
          // block persistent downstream mutations until discrepancy is resolved.
          const explicitlyUpdatingWeight =
            /(?:atualiz\w*|mud\w*|alter\w*|registr\w*|salv\w*)\s+(?:meu\s+)?peso/i.test(trimmedUser);

          if (!explicitlyUpdatingWeight) {
            return {
              allowed: false,
              intent: "BASELINE_CONFLICT",
              reason: `BASELINE_CONFLICT: Conflito material entre o peso informado no chat (${reportedWeight} kg) e o último peso registrado no HealthVault (${vaultWeightKg} kg). Apresente a proposta usando o dado informado como suposição temporária e solicite confirmação antes de gravar no prontuário.`,
            };
          }
        }
      }
    }

    // 4. Check explicit mutation intent
    const hasExplicitMutation = EXPLICIT_MUTATION_PATTERNS.some((p) => p.test(trimmedUser));
    const hasAdvisory = ADVISORY_PATTERNS.some((p) => p.test(trimmedUser));

    // If explicit mutation directive is present (e.g. "atualize minha dieta", "registre meu peso", "pare meu medicamento", "salve o plano"):
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
