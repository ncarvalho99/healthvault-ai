/**
 * Human-readable origin of a recommendation, derived from its recorded sourceType
 * (never assumed to be the AI when a name is missing).
 */
export function recommendationOriginLabel(sourceType?: string | null, sourceName?: string | null): string {
  const name = sourceName?.trim();
  switch (sourceType) {
    case "AI_AGENT":
      return name ? `Assistente de IA (${name})` : "Assistente de IA";
    case "USER_NOTE":
      return name ? `Registro manual — ${name}` : "Registro manual";
    case "DOCTOR":
      return name ? `Médico — ${name}` : "Médico";
    case "LAB_REPORT":
      return name ? `Laudo laboratorial — ${name}` : "Laudo laboratorial";
    default:
      return name || "Origem não informada";
  }
}

/**
 * Statuses the account owner can legitimately assign through the manual REST/UI path.
 * Clinical-validation statuses (DOCTOR_RECOMMENDATION, CONFIRMED) require a trusted
 * medical origin and are never newly assignable by the user themself.
 */
export const USER_ASSIGNABLE_RECOMMENDATION_STATUSES = ["DRAFT", "USER_NOTE", "ARCHIVED"] as const;

const CLINICAL_VALIDATION_STATUSES = new Set(["DOCTOR_RECOMMENDATION", "CONFIRMED"]);

/**
 * Statuses a manual edit may set on a recommendation: the user-assignable set, plus
 * AI_SUGGESTION for records whose recorded source is the AI agent (e.g. un-archiving),
 * plus the record's current status so editing title/notes never forces a status change.
 */
export function manualRecommendationStatusOptions(
  sourceType?: string | null,
  currentStatus?: string | null
): string[] {
  const options: string[] = [...USER_ASSIGNABLE_RECOMMENDATION_STATUSES];
  if (sourceType === "AI_AGENT") options.unshift("AI_SUGGESTION");
  if (currentStatus && !options.includes(currentStatus)) options.unshift(currentStatus);
  return options;
}

/** Server-side check for a manual status transition. */
export function isManualRecommendationStatusAllowed(
  requested: string,
  sourceType?: string | null,
  currentStatus?: string | null
): boolean {
  return manualRecommendationStatusOptions(sourceType, currentStatus).includes(requested);
}

/**
 * Status shown in the UI. A clinical-validation status is only displayed as such when the
 * recorded origin is a doctor; otherwise it is shown as unverified instead of implying a
 * medical validation that never happened (covers legacy rows).
 */
export function displayRecommendationStatus(status: string, sourceType?: string | null): string {
  if (CLINICAL_VALIDATION_STATUSES.has(status) && sourceType !== "DOCTOR") return "UNVERIFIED_CLINICAL";
  return status;
}

export const RECOMMENDATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  AI_SUGGESTION: "Sugestão de IA",
  DOCTOR_RECOMMENDATION: "Recomendação Médica",
  CONFIRMED: "Confirmado / Validado",
  USER_NOTE: "Nota Pessoal",
  ARCHIVED: "Arquivado",
};
