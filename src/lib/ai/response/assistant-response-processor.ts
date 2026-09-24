import { ReasoningFilter } from "./reasoning-filter";
import { MarkdownNormalizer } from "./markdown-normalizer";
import { resolveReasoningPolicy } from "./reasoning-policy";
import { ProcessedAssistantResponse, ReasoningPolicy } from "./types";

export class AssistantResponseProcessor {
  /**
   * Processes raw LLM response from OmniRoute:
   * 1. Inspects and strips separate reasoning fields (reasoning_content, thinking, reasoning).
   * 2. Filters <think> and <thinking> tags from text.
   * 3. Normalizes whitespace while preserving markdown.
   * 4. Assembles safe metadata.
   */
  static process(rawMessage: any, modelId: string, customPolicy?: ReasoningPolicy): ProcessedAssistantResponse {
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

    // Count reasoning tokens if reported in usage
    const reasoningTokenCount = rawMessage?.usage?.completion_tokens_details?.reasoning_tokens || undefined;

    return {
      rawContent,
      cleanContent,
      hasReasoning: reasoningDetected,
      reasoningPolicy: policy,
      reasoningSuppressionRequested: policy === "DISABLED",
      reasoningLeakDetected,
      reasoningSuppressed,
      reasoningTokenCount,
      metadata: {
        reasoningPolicy: policy,
        reasoningSuppressionRequested: policy === "DISABLED",
        reasoningLeakDetected,
        reasoningSuppressed,
        reasoningTokenCount,
      },
    };
  }
}
