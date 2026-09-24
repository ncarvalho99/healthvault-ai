export interface FilterResult {
  cleanText: string;
  hadReasoningTag: boolean;
}

export class ReasoningFilter {
  /**
   * Filters out internal reasoning, scratchpads, and chain-of-thought blocks such as:
   * <think>...</think>, <thinking>...</thinking>, <reasoning>...</reasoning>
   * including multiline, case-variants, multiple blocks, and unclosed trailing tags.
   */
  static filterThinkingTags(text: string | null | undefined): FilterResult {
    if (!text) {
      return { cleanText: "", hadReasoningTag: false };
    }

    let cleaned = text;
    let hadReasoningTag = false;

    // 1. Matched closed tags: <think>...</think>, <thinking>...</thinking>, <reasoning>...</reasoning>
    const closedTagRegex = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;
    if (closedTagRegex.test(cleaned)) {
      hadReasoningTag = true;
      cleaned = cleaned.replace(closedTagRegex, "");
    }

    // 2. Unclosed opening tag (when reasoning was cut off or not properly closed)
    const unclosedTagRegex = /<(think|thinking|reasoning)>[\s\S]*$/gi;
    if (unclosedTagRegex.test(cleaned)) {
      hadReasoningTag = true;
      cleaned = cleaned.replace(unclosedTagRegex, "");
    }

    // 3. Orphaned closing tags if any
    const orphanedCloseRegex = /<\/(think|thinking|reasoning)>/gi;
    if (orphanedCloseRegex.test(cleaned)) {
      hadReasoningTag = true;
      cleaned = cleaned.replace(orphanedCloseRegex, "");
    }

    return {
      cleanText: cleaned,
      hadReasoningTag,
    };
  }
}
