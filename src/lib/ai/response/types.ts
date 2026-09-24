export type ReasoningPolicy = "AUTO" | "DISABLED" | "LOW" | "MEDIUM" | "HIGH";

export interface TokenUsageTelemetry {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

export interface ProcessedAssistantResponse {
  rawContent: string | null;
  cleanContent: string;
  hasReasoning: boolean;
  reasoningPolicy: ReasoningPolicy;
  reasoningSuppressionRequested: boolean;
  reasoningLeakDetected: boolean;
  reasoningSuppressed: boolean;
  reasoningTokenCount?: number;
  usage?: TokenUsageTelemetry;
  metadata: Record<string, any>;
}
