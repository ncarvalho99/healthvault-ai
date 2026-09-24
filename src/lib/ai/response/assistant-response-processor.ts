import { ReasoningFilter } from "./reasoning-filter";
import { MarkdownNormalizer } from "./markdown-normalizer";
import { resolveReasoningPolicy } from "./reasoning-policy";
import { ProcessedAssistantResponse, ReasoningPolicy, TokenUsageTelemetry } from "./types";

export class AssistantResponseProcessor {
  /**
   * Processes raw LLM response from OmniRoute:
   * 1. Inspects and strips separate reasoning fields (reasoning_content, thinking, reasoning, analysis).
   * 2. Filters <think> and <thinking> tags from text.
   * 3. Normalizes whitespace while preserving markdown.
   * 4. Extracts root completion usage and reasoning token telemetry.
   * 5. Assembles safe metadata without persisting raw reasoning text.
   */
  static process(
    rawMessage: any,
    modelId: string,
    customPolicy?: ReasoningPolicy,
    completionUsage?: any
  ): ProcessedAssistantResponse {
    const rawContent: string | null = rawMessage?.content || null;
    const policy = customPolicy || resolveReasoningPolicy(modelId);

    // Detect if model returned separate reasoning fields
    const separateReasoning = Boolean(
      rawMessage?.reasoning_content ||
      rawMessage?.reasoning ||
      rawMessage?.thinking ||
      rawMessage?.analysis
    );

    // Filter tags from visible content
    const filterResult = ReasoningFilter.filterThinkingTags(rawContent);

    // Normalize presentation
    const cleanContent = MarkdownNormalizer.normalize(filterResult.cleanText);

    const hadTagReasoning = filterResult.hadReasoningTag;
    const reasoningDetected = separateReasoning || hadTagReasoning;
    const reasoningSuppressed = hadTagReasoning || separateReasoning;

    // A leak is detected when thinking tags appeared in the raw content intended for user
    const reasoningLeakDetected = hadTagReasoning;

    // Extract usage telemetry from root completion usage (preferred) or message-level fallback
    const usageSource = completionUsage || rawMessage?.usage;
    const usage: TokenUsageTelemetry | undefined = usageSource
      ? {
          prompt_tokens: typeof usageSource.prompt_tokens === "number" ? usageSource.prompt_tokens : undefined,
          completion_tokens: typeof usageSource.completion_tokens === "number" ? usageSource.completion_tokens : undefined,
          total_tokens: typeof usageSource.total_tokens === "number" ? usageSource.total_tokens : undefined,
          reasoning_tokens:
            typeof usageSource.completion_tokens_details?.reasoning_tokens === "number"
              ? usageSource.completion_tokens_details.reasoning_tokens
              : typeof usageSource.reasoning_tokens === "number"
              ? usageSource.reasoning_tokens
              : undefined,
          cached_tokens:
            typeof usageSource.prompt_tokens_details?.cached_tokens === "number"
              ? usageSource.prompt_tokens_details.cached_tokens
              : typeof usageSource.cached_tokens === "number"
              ? usageSource.cached_tokens
              : undefined,
        }
      : undefined;

    const reasoningTokenCount = usage?.reasoning_tokens;

    return {
      rawContent,
      cleanContent,
      hasReasoning: reasoningDetected,
      reasoningPolicy: policy,
      reasoningSuppressionRequested: policy === "DISABLED",
      reasoningLeakDetected,
      reasoningSuppressed,
      reasoningTokenCount,
      usage,
      metadata: {
        reasoningPolicy: policy,
        reasoningSuppressionRequested: policy === "DISABLED",
        reasoningLeakDetected,
        reasoningSuppressed,
        reasoningTokenCount,
        ...(usage ? { usage } : {}),
      },
    };
  }
}
