/**
 * WriteIntentGuard
 *
 * Deterministic server-side guard that distinguishes advisory/generative requests
 * from persistent mutation intent. Authorization is scoped per domain: a write
 * instruction only authorizes the domains it (or the confirmed offer) names.
 * Weight baseline conflicts are carried as explicit state, never re-derived from history.
 */

import {
  WriteDomain,
  mentionedWriteDomains,
  offeredWriteDomains,
  findSaveOfferSentence,
  toolWriteDomain,
  parseReportedWeightKg,
} from "./domain-intent";

/**
 * Mutations already persisted earlier in the current chat turn.
 * Only successful, non-pending writes update this state.
 */
export interface TurnMutationState {
  weightUpdatedThisTurn: boolean;
  updatedWeightKg: number | null;
  dietUpdatedThisTurn: boolean;
  recommendationHandledThisTurn: boolean;
}

export function createTurnMutationState(): TurnMutationState {
  return {
    weightUpdatedThisTurn: false,
    updatedWeightKg: null,
    dietUpdatedThisTurn: false,
    recommendationHandledThisTurn: false,
  };
}

/**
 * Records a dispatched tool result into the turn state. Metric and diet writes only count
 * when actually persisted (not failed, not pending manual approval). A recommendation counts
 * as handled once proposed, so no second version is generated for the same turn.
 */
export function recordTurnMutation(
  state: TurnMutationState,
  toolName: string,
  result: { success: boolean; requires_approval?: boolean; data?: any }
): void {
  if (!result.success) return;
  const persisted = !result.requires_approval;

  if (toolName === "healthvault_add_body_metric" && persisted && typeof result.data?.weightKg === "number") {
    state.weightUpdatedThisTurn = true;
    state.updatedWeightKg = result.data.weightKg;
  }
  if ((toolName === "healthvault_create_diet" || toolName === "healthvault_update_diet") && persisted) {
    state.dietUpdatedThisTurn = true;
  }
  if (toolName === "healthvault_create_recommendation" || toolName === "healthvault_update_recommendation") {
    state.recommendationHandledThisTurn = true;
  }
}

/**
 * Unresolved difference between a weight the user reported and the Vault, carried across turns
 * on the assistant message metadata. `vaultWeightKg` is the Vault value it was measured against:
 * if the Vault changes afterwards, the conflict is superseded.
 */
export interface PendingBaselineConflict {
  reportedWeightKg: number;
  vaultWeightKg: number;
}

const MATERIAL_WEIGHT_DIFF_KG = 4.0;

/**
 * Weight the user is currently asserting: the current message, or a still-valid pending conflict.
 */
export function resolveReportedWeight(
  userMessage: string | undefined,
  vaultWeightKg: number | null | undefined,
  pending: PendingBaselineConflict | null | undefined
): number | null {
  const fromMessage = parseReportedWeightKg(userMessage);
  if (fromMessage !== null) return fromMessage;
  if (pending && typeof vaultWeightKg === "number" && Math.abs(pending.vaultWeightKg - vaultWeightKg) < 0.05) {
    return pending.reportedWeightKg;
  }
  return null;
}

/**
 * Conflict to carry into the next turn, or null when there is none or it was resolved this turn.
 */
export function computePendingBaselineConflict(
  userMessage: string | undefined,
  vaultWeightKg: number | null | undefined,
  previousPending: PendingBaselineConflict | null | undefined,
  turnState: TurnMutationState
): PendingBaselineConflict | null {
  if (typeof vaultWeightKg !== "number" || vaultWeightKg <= 0) return null;
  const reported = resolveReportedWeight(userMessage, vaultWeightKg, previousPending);
  if (reported === null || Math.abs(reported - vaultWeightKg) < MATERIAL_WEIGHT_DIFF_KG) return null;
  if (
    turnState.weightUpdatedThisTurn &&
    typeof turnState.updatedWeightKg === "number" &&
    Math.abs(turnState.updatedWeightKg - reported) < 0.1
  ) {
    return null;
  }
  return { reportedWeightKg: reported, vaultWeightKg };
}

export interface WriteIntentCheckOptions {
  userMessage?: string;
  previousAssistantMessage?: string;
  toolName: string;
  toolAccess?: string;
  toolCategory?: string;
  vaultWeightKg?: number | null;
  pendingBaselineConflict?: PendingBaselineConflict | null;
  turnMutationState?: TurnMutationState;
}

export interface WriteIntentCheckResult {
  allowed: boolean;
  intent:
    | "EXPLICIT_MUTATION"
    | "CONFIRMATION"
    | "ADVISORY"
    | "BASELINE_CONFLICT"
    | "DOMAIN_NOT_AUTHORIZED"
    | "NO_WRITE_INTENT";
  reason?: string;
  authorizedDomains?: WriteDomain[];
}

const ADVISORY_PATTERNS = [
  /\b(monte|montar|crie\s+uma\s+sugest[aã]o|sugira|sugerir|sugest[aã]o\s+de|recomende|recomendar|recomenda[cç][aã]o|quais\s+op[cç][oõ]es|qual\s+protocolo|ideias\s+de|o\s+que\s+voc[eê]\s+acha|como\s+seria|calcule|calcular|simule|simular|proponha|propor|op[cç][oõ]es\s+de|dicas\s+de)\b/i,
  /\b(suggest|recommend|propose|calculate|simulate|what\s+do\s+you\s+think|ideas\s+for|how\s+would)\b/i,
];

const EXPLICIT_MUTATION_PATTERNS = [
  /\b(registre|registrar|grave|gravar|salve|salva|salvar|adicione|adicionar|atualize|atualizar|altere|alterar|modifique|modificar|mude|mudar|troque|trocar|pare|parar|suspenda|suspender|descontinue|descontinuar|interrompa|interromper|aplique|aplicar|cadastre|cadastrar|defina|definir|coloque|colocar|insira|inserir|delete|deletar|exclua|excluir|remova|remover|anote|anotar|guarde|guardar)\b/i,
  /\b(save|record|update|change|stop|discontinue|apply|set|add|register|delete|remove|modify)\b/i,
  /\b(minha\s+nova\s+dieta\s+[eé]|meu\s+novo\s+peso\s+[eé]|nova\s+dose\s+[eé]|quero\s+salvar|pode\s+salvar|pode\s+gravar|pode\s+registrar|pode\s+atualizar|por\s+favor\s+salve)\b/i,
];

const GENERIC_AFFIRMATIVE_PATTERNS = [
  /^(sim|ok|pode|confirmo|confirmar|quero|com\s+certeza|fa[cç]a\s+isso|yes|confirm|go\s+ahead)[\s.!,]*$/i,
];

// Clause boundaries: sentence ends, ", " (not decimal commas), and connectives.
const CLAUSE_SPLIT = /[;!?\n]+|\.(?=\s|$)|,(?=\s)|\s+e\s+|\s+mas\s+|\s+depois\s+|\s+and\s+/i;

// A negation shortly before the write verb turns the clause into an explicit refusal
// ("não salve", "não quero que você registre", "do not save").
const NEGATION_BEFORE_VERB = /\b(?:n[aã]o|nunca|jamais|nem|sem|not|never|don'?t)\b(?:\s+\S+){0,3}\s*$/i;

/** Index of the first write verb in the clause, or -1. */
function firstMutationVerbIndex(clause: string): number {
  let first = -1;
  for (const p of EXPLICIT_MUTATION_PATTERNS) {
    const i = clause.search(p);
    if (i !== -1 && (first === -1 || i < first)) first = i;
  }
  return first;
}

interface WriteScope {
  mode: "MUTATION" | "CONFIRMATION" | "ADVISORY" | "NEGATED" | "NONE";
  domains: Set<WriteDomain>;
}

/**
 * Splits the message into clauses and collects the domains named by clauses that carry a
 * write verb. A clause without its own verb inherits the previous clause's mode
 * ("atualize minha dieta e medicação", "não altere o peso nem a dieta"). A write clause naming
 * no domain ("sim, salve") binds to what the previous assistant turn offered. Negated clauses
 * ("não salve a dieta") deny their domains even if another clause names them.
 */
export function resolveWriteScope(userMessage: string, previousAssistantMessage?: string): WriteScope {
  const trimmed = userMessage.trim();

  if (GENERIC_AFFIRMATIVE_PATTERNS.some((p) => p.test(trimmed))) {
    if (!findSaveOfferSentence(previousAssistantMessage)) return { mode: "NONE", domains: new Set() };
    return { mode: "CONFIRMATION", domains: offeredWriteDomains(previousAssistantMessage) };
  }

  const domains = new Set<WriteDomain>();
  const denied = new Set<WriteDomain>();
  let lastMode: "MUTATION" | "ADVISORY" | "NEGATED" | null = null;
  let sawMutation = false;
  let sawAdvisory = false;
  let sawNegation = false;
  let domainlessMutation = false;
  let domainlessNegation = false;

  for (const clause of trimmed.split(CLAUSE_SPLIT)) {
    if (!clause || !clause.trim()) continue;
    const verbIndex = firstMutationVerbIndex(clause);
    const isNegated = verbIndex !== -1 && NEGATION_BEFORE_VERB.test(clause.slice(0, verbIndex));
    const isMutation = verbIndex !== -1 && !isNegated;
    const isAdvisory = verbIndex === -1 && ADVISORY_PATTERNS.some((p) => p.test(clause));
    const hasOwnMode = isMutation || isNegated || isAdvisory;
    const mode: "MUTATION" | "ADVISORY" | "NEGATED" | null = isMutation
      ? "MUTATION"
      : isNegated
      ? "NEGATED"
      : isAdvisory
      ? "ADVISORY"
      : lastMode;
    if (hasOwnMode) lastMode = mode;
    if (isMutation) sawMutation = true;
    if (isNegated) sawNegation = true;
    if (isAdvisory) sawAdvisory = true;

    const clauseDomains = mentionedWriteDomains(clause);
    if (mode === "MUTATION") {
      if (clauseDomains.size === 0 && isMutation) domainlessMutation = true;
      clauseDomains.forEach((d) => domains.add(d));
    } else if (mode === "NEGATED") {
      if (clauseDomains.size === 0 && isNegated) domainlessNegation = true;
      clauseDomains.forEach((d) => denied.add(d));
    }
  }

  const offered = offeredWriteDomains(previousAssistantMessage);
  if (domainlessMutation) offered.forEach((d) => domains.add(d));
  if (domainlessNegation) offered.forEach((d) => denied.add(d));
  denied.forEach((d) => domains.delete(d));

  if (sawMutation && domains.size > 0) return { mode: "MUTATION", domains };
  if (sawNegation) return { mode: "NEGATED", domains: new Set() };
  if (sawMutation) return { mode: "MUTATION", domains };
  if (sawAdvisory) return { mode: "ADVISORY", domains: new Set() };
  return { mode: "NONE", domains: new Set() };
}

export class WriteIntentGuard {
  /**
   * Determines whether an incoming tool execution is authorized by the user's intent.
   * Read tools are always allowed. Write tools require explicit mutation intent or a valid
   * confirmation that covers the tool's domain.
   */
  static check(options: WriteIntentCheckOptions): WriteIntentCheckResult {
    const {
      userMessage,
      previousAssistantMessage = "",
      toolName,
      toolAccess,
      toolCategory,
      vaultWeightKg,
      pendingBaselineConflict,
      turnMutationState,
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

    // 2. Material weight baseline conflict blocks diet/recommendation writes until the weight is persisted
    if (
      typeof vaultWeightKg === "number" &&
      vaultWeightKg > 0 &&
      (toolName.includes("diet") || toolName.includes("recommendation"))
    ) {
      const reportedWeight = resolveReportedWeight(trimmedUser, vaultWeightKg, pendingBaselineConflict);

      if (reportedWeight !== null && Math.abs(reportedWeight - vaultWeightKg) >= MATERIAL_WEIGHT_DIFF_KG) {
        // Resolved only by real state: a body metric persisted earlier in this same turn
        // whose weight matches the reported weight. Wording alone ("registre meu peso") is not proof.
        const persistedThisTurn =
          turnMutationState?.weightUpdatedThisTurn === true &&
          typeof turnMutationState.updatedWeightKg === "number" &&
          Math.abs(turnMutationState.updatedWeightKg - reportedWeight) < 0.1;

        if (!persistedThisTurn) {
          return {
            allowed: false,
            intent: "BASELINE_CONFLICT",
            reason: `BASELINE_CONFLICT: Conflito material entre o peso informado no diálogo (${reportedWeight} kg) e o último peso registrado no HealthVault (${vaultWeightKg} kg) ainda não foi resolvido. Registre primeiro o peso atual com healthvault_add_body_metric (somente se o usuário pediu explicitamente para atualizar o peso, ex: 'sim, considere ${reportedWeight} kg como meu peso atual e registre isso') e só depois persista dieta ou recomendação.`,
          };
        }
      }
    }

    // 3. Domain-scoped write authorization
    const scope = resolveWriteScope(trimmedUser, previousAssistantMessage);
    const toolDomain = toolWriteDomain(toolName, toolCategory);
    const authorizedDomains = Array.from(scope.domains);

    if (scope.mode === "MUTATION" || scope.mode === "CONFIRMATION") {
      if (toolDomain && scope.domains.has(toolDomain)) {
        return {
          allowed: true,
          intent: scope.mode === "CONFIRMATION" ? "CONFIRMATION" : "EXPLICIT_MUTATION",
          authorizedDomains,
        };
      }
      return {
        allowed: false,
        intent: "DOMAIN_NOT_AUTHORIZED",
        authorizedDomains,
        reason: `WRITE_INTENT_REQUIRED: O usuário autorizou gravação apenas em: ${authorizedDomains.join(", ") || "nenhum domínio identificado"}. A ferramenta ${toolName} (${toolDomain || "domínio desconhecido"}) não foi autorizada nesta mensagem. Apresente essa parte como sugestão e pergunte explicitamente antes de gravá-la.`,
      };
    }

    if (scope.mode === "NEGATED") {
      return {
        allowed: false,
        intent: "NO_WRITE_INTENT",
        reason:
          "WRITE_INTENT_REQUIRED: O usuário pediu explicitamente para NÃO gravar esta alteração no HealthVault. Não execute a gravação; responda apenas de forma consultiva.",
      };
    }

    if (GENERIC_AFFIRMATIVE_PATTERNS.some((p) => p.test(trimmedUser))) {
      return {
        allowed: false,
        intent: "NO_WRITE_INTENT",
        reason: `WRITE_INTENT_REQUIRED: Resposta afirmativa genérica ('${trimmedUser}') sem oferta prévia de persistência no HealthVault não autoriza gravação persistente.`,
      };
    }

    if (scope.mode === "ADVISORY") {
      return {
        allowed: false,
        intent: "ADVISORY",
        reason:
          "WRITE_INTENT_REQUIRED: A solicitação atual é consultiva/propositiva ('monte/recomende/sugira') e não expressa comando explícito de gravação ('salve', 'registre', 'atualize no vault'). Apresente a recomendação/plano ao usuário e pergunte se ele deseja salvar/aplicar essas alterações no prontuário.",
      };
    }

    return {
      allowed: false,
      intent: "NO_WRITE_INTENT",
      reason:
        "WRITE_INTENT_REQUIRED: Nenhuma intenção explícita de mutação persistente foi detectada na mensagem do usuário. Apresente a resposta consultivamente e solicite confirmação antes de gravar no HealthVault.",
    };
  }
}
