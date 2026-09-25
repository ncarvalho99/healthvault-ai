/**
 * Shared topic/domain detection for tool scoping (ToolSelector) and write authorization (WriteIntentGuard).
 * Both layers must agree on which HealthVault domain a piece of text refers to.
 */

export type WriteDomain =
  | "metrics"
  | "nutrition"
  | "medications"
  | "symptoms"
  | "labs"
  | "recommendations"
  | "reminders";

export interface TopicFlags {
  diet: boolean;
  medication: boolean;
  metric: boolean;
  symptom: boolean;
  lab: boolean;
  plan: boolean;
  protocol: boolean;
  reminder: boolean;
}

const TOPIC_PATTERNS: Record<keyof TopicFlags, RegExp> = {
  diet: /dieta|caloria|macro|prote[ií]na|carbo|gordura|refei[cç][aã]o|alimento|comida|nutri|\bdiet\b|calorie/i,
  medication: /medicamento|medica[cç][aã]o|rem[eé]dio|dose|dosagem|(?<![a-z])(?:mg|mcg)\b|ozempic|semaglutid|retatrutid|tirzepatid|aplica[cç][aã]o|farm[aá]|medication/i,
  metric: /peso|pesagem|balan[cç]a|gordura corporal|\bbf\b|cintura|medida|(?<![a-z])kg\b|weight/i,
  symptom: /sintoma|\bdor\b|dores|n[aá]usea|rea[cç][aã]o|efeito|azia|cabe[cç]a|fadiga|tontura|symptom/i,
  lab: /exame|laborat|sangue|glicemia|colesterol|hba1c|tsh|biomarcador/i,
  // A "plano" in this app is the nutrition plan; protocols/recommendations are a separate record
  plan: /plano/i,
  protocol: /protocolo|recomenda[cç]|protocol|recommendation/i,
  reminder: /lembrete|lembrar|agend|reminder/i,
};

export function detectTopics(text: string): TopicFlags {
  const flags = {} as TopicFlags;
  for (const key of Object.keys(TOPIC_PATTERNS) as Array<keyof TopicFlags>) {
    flags[key] = TOPIC_PATTERNS[key].test(text);
  }
  return flags;
}

export function hasAnyTopic(flags: TopicFlags): boolean {
  return Object.values(flags).some(Boolean);
}

/**
 * Domains a text explicitly refers to, used to bound what a write instruction authorizes.
 * Least privilege: a nutrition plan authorizes nutrition only; a protocol/recommendation
 * authorizes recommendations only. Both are authorized only when both are named.
 */
export function mentionedWriteDomains(text: string): Set<WriteDomain> {
  const t = detectTopics(text);
  const domains = new Set<WriteDomain>();
  if (t.diet || t.plan) domains.add("nutrition");
  if (t.protocol) domains.add("recommendations");
  if (t.medication) domains.add("medications");
  if (t.metric) domains.add("metrics");
  if (t.symptom) domains.add("symptoms");
  if (t.lab) domains.add("labs");
  if (t.reminder) domains.add("reminders");
  return domains;
}

const OFFER_SENTENCE_PATTERNS = [
  /(?:quer\s+que\s+eu|deseja\s+que\s+eu|posso|gostaria\s+que\s+eu)\s+(?:salve|salvar|registre|registrar|grave|gravar|aplique|aplicar|atualize|atualizar)/i,
  /(?:salvar|gravar|registrar|aplicar)\s+(?:este|esse|o)\s+plano/i,
  /(?:would\s+you\s+like\s+me\s+to|should\s+I)\s+(?:save|record|apply|register)/i,
];

/**
 * The sentence in which the assistant offered to persist something, if any (last one wins).
 */
export function findSaveOfferSentence(assistantMessage?: string | null): string | null {
  if (!assistantMessage) return null;
  const sentences = assistantMessage.split(/(?<=[.!?])\s+|\n+/);
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (OFFER_SENTENCE_PATTERNS.some((p) => p.test(sentences[i]))) return sentences[i];
  }
  return null;
}

/**
 * Domains the previous assistant turn put on the table: the save-offer sentence when it names
 * domains, otherwise everything the message discussed.
 */
export function offeredWriteDomains(assistantMessage?: string | null): Set<WriteDomain> {
  if (!assistantMessage) return new Set();
  const offer = findSaveOfferSentence(assistantMessage);
  if (offer) {
    const fromOffer = mentionedWriteDomains(offer);
    if (fromOffer.size > 0) return fromOffer;
  }
  return mentionedWriteDomains(assistantMessage);
}

/**
 * Tool category → write domain. Falls back to the tool name when no category is supplied.
 */
export function toolWriteDomain(toolName: string, toolCategory?: string): WriteDomain | null {
  const known: WriteDomain[] = ["metrics", "nutrition", "medications", "symptoms", "labs", "recommendations", "reminders"];
  if (toolCategory && (known as string[]).includes(toolCategory)) return toolCategory as WriteDomain;
  if (/metric/.test(toolName)) return "metrics";
  if (/diet|food/.test(toolName)) return "nutrition";
  if (/medication/.test(toolName)) return "medications";
  if (/symptom/.test(toolName)) return "symptoms";
  if (/lab/.test(toolName)) return "labs";
  if (/recommendation/.test(toolName)) return "recommendations";
  if (/reminder/.test(toolName)) return "reminders";
  return null;
}

/**
 * Body weight the user states in a message ("estou com 98 kg", "atualize meu peso para 98 kg",
 * "considere 98 kg como meu peso"). Other kg values (e.g. loads lifted) are ignored.
 */
export function parseReportedWeightKg(text?: string | null): number | null {
  if (!text) return null;
  const match =
    text.match(/(?:peso|pesando|pesei|estou\s+com|balan[cç]a|weigh)[^.\n\d]{0,25}(\d+(?:[.,]\d+)?)\s*kg\b/i) ||
    text.match(/(\d+(?:[.,]\d+)?)\s*kg\b[^.\n]{0,30}\bpeso\b/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(",", "."));
  return isNaN(value) ? null : value;
}
