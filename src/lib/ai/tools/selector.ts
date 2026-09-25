import { ToolRegistry } from "./registry";
import { HealthVaultTool } from "./types";
import { detectTopics, hasAnyTopic, findSaveOfferSentence, TopicFlags } from "./domain-intent";

export interface ToolScopingOptions {
  userMessage?: string;
  /** Previous assistant turn; scopes short confirmations ("sim") to what was offered */
  previousAssistantMessage?: string;
  agentMode?: "AGENT" | "CHAT_ONLY" | "MANUAL";
  categoryHint?: string;
}

export class ToolSelector {
  /**
   * Scopes and selects the optimal list of tools to send in the LLM completion request.
   */
  static selectTools(options: ToolScopingOptions = {}): HealthVaultTool[] {
    const { userMessage = "", previousAssistantMessage, agentMode = "AGENT" } = options;

    // In MANUAL mode, no tools are dispatched
    if (agentMode === "MANUAL") {
      return [];
    }

    const allTools = ToolRegistry.getAll();
    const isChatOnly = agentMode === "CHAT_ONLY";

    // In CHAT_ONLY mode, only tools with access === "read" are allowed (read-only HealthVault access)
    const availablePool = isChatOnly ? allTools.filter((t) => t.access === "read") : allTools;

    // Base read-only tools always included
    const baseToolNames = ["healthvault_ping", "healthvault_get_context", "healthvault_search"];

    // Topics of the current message; a message with no topic of its own (e.g. "sim", "pode salvar")
    // inherits the topics of the previous assistant offer instead of unlocking every tool
    let topics: TopicFlags = detectTopics(userMessage);
    if (!hasAnyTopic(topics) && previousAssistantMessage) {
      const offer = findSaveOfferSentence(previousAssistantMessage);
      const offerTopics = offer ? detectTopics(offer) : null;
      topics = offerTopics && hasAnyTopic(offerTopics) ? offerTopics : detectTopics(previousAssistantMessage);
    }
    const isDietTopic = topics.diet;
    const isMedTopic = topics.medication;
    const isMetricTopic = topics.metric;
    const isSymptomTopic = topics.symptom;
    const isLabTopic = topics.lab;
    const isPlanTopic = topics.plan;
    const isReminderTopic = topics.reminder;

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
    if (isReminderTopic) {
      categories.add("reminders");
    }

    if (categories.size > 0) {
      return availablePool.filter((t) => baseToolNames.includes(t.name) || categories.has(t.category));
    }

    // Default: no topic detected, return available pool
    return availablePool;
  }
}
