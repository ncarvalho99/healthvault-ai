import { ToolRegistry } from "./registry";
import { HealthVaultTool } from "./types";

export interface ToolScopingOptions {
  userMessage?: string;
  agentMode?: "AGENT" | "CHAT_ONLY" | "MANUAL";
  categoryHint?: string;
}

export class ToolSelector {
  /**
   * Scopes and selects the optimal list of tools to send in the LLM completion request.
   */
  static selectTools(options: ToolScopingOptions = {}): HealthVaultTool[] {
    const { userMessage = "", agentMode = "AGENT" } = options;

    // In MANUAL mode, no tools are dispatched
    if (agentMode === "MANUAL") {
      return [];
    }

    const allTools = ToolRegistry.getAll();
    const isChatOnly = agentMode === "CHAT_ONLY";

    // In CHAT_ONLY mode, only tools with access === "read" are allowed (read-only HealthVault access)
    const availablePool = isChatOnly ? allTools.filter((t) => t.access === "read") : allTools;

    const text = userMessage.toLowerCase();

    // Base read-only tools always included
    const baseToolNames = ["healthvault_ping", "healthvault_get_context", "healthvault_search"];

    // Keyword detection for focused scoping
    const isDietTopic = /dieta|caloria|macro|prote[ií]na|carbo|gordura|refei[cç][aã]o|alimento|comida|nutri/i.test(text);
    const isMedTopic = /medicamento|rem[eé]dio|dose|dosagem|mg|mcg|ozempic|semaglutid|retatrutid|tirzepatid|aplica[cç][aã]o|farm[aá]/i.test(text);
    const isMetricTopic = /peso|pesagem|balan[cç]a|gordura corporal|bf|cintura|medida|kg/i.test(text);
    const isSymptomTopic = /sintoma|dor|n[aá]usea|rea[cç][aã]o|efeito|azia|cabe[cç]a|fadiga|tontura/i.test(text);
    const isLabTopic = /exame|laborat|sangue|glicemia|colesterol|hba1c|tsh|biomarcador/i.test(text);

    // Saving a proposed plan/protocol touches diet and recommendation records
    const isPlanTopic = /plano|protocolo|recomenda[cç]/i.test(text);

    // Union of every detected domain, so multi-domain requests (e.g. "atualize meu peso e salve o plano")
    // receive all the tools they need while unrelated domains stay out of scope
    const categories = new Set<string>();
    if (isDietTopic || isPlanTopic) {
      categories.add("nutrition");
      categories.add("recommendations");
    }
    if (isMedTopic) {
      categories.add("medications");
      categories.add("symptoms");
      categories.add("recommendations");
    }
    if (isMetricTopic) {
      categories.add("metrics");
    }
    if (isSymptomTopic) {
      categories.add("symptoms");
      categories.add("medications");
    }
    if (isLabTopic) {
      categories.add("labs");
    }

    if (categories.size > 0) {
      return availablePool.filter((t) => baseToolNames.includes(t.name) || categories.has(t.category));
    }

    // Default: no topic detected, return available pool
    return availablePool;
  }
}
