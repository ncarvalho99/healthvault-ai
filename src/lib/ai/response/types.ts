export type ReasoningPolicy = "AUTO" | "DISABLED" | "LOW" | "MEDIUM" | "HIGH";

export interface ProcessedAssistantResponse {
  rawContent: string | null;
  cleanContent: string;
  hasReasoning: boolean;
  reasoningPolicy: ReasoningPolicy;
  reasoningSuppressionRequested: boolean;
  reasoningLeakDetected: boolean;
  reasoningSuppressed: boolean;
  reasoningTokenCount?: number;
  metadata: Record<string, any>;
}
