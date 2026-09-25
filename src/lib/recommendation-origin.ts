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
