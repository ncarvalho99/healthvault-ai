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

    // If a specific topic is detected, return focused tool group to save tokens and avoid LLM hallucinations
    if (isDietTopic && !isMedTopic) {
      return availablePool.filter(
        (t) => baseToolNames.includes(t.name) || t.category === "nutrition" || t.category === "recommendations"
      );
    }

    if (isMedTopic && !isDietTopic) {
      return availablePool.filter(
        (t) => baseToolNames.includes(t.name) || t.category === "medications" || t.category === "symptoms" || t.category === "recommendations"
      );
    }

    if (isMetricTopic && !isDietTopic && !isMedTopic) {
      return availablePool.filter(
        (t) => baseToolNames.includes(t.name) || t.category === "metrics"
      );
    }

    if (isSymptomTopic && !isMedTopic) {
      return availablePool.filter(
        (t) => baseToolNames.includes(t.name) || t.category === "symptoms" || t.category === "medications"
      );
    }

    if (isLabTopic) {
      return availablePool.filter(
        (t) => baseToolNames.includes(t.name) || t.category === "labs"
      );
    }

    // Default: return available pool
    return availablePool;
  }
}
