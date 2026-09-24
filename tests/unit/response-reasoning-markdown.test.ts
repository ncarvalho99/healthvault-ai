import { describe, it } from "node:test";
import assert from "node:assert";
import { ReasoningFilter } from "../../src/lib/ai/response/reasoning-filter";
import { MarkdownNormalizer } from "../../src/lib/ai/response/markdown-normalizer";
import { resolveReasoningPolicy } from "../../src/lib/ai/response/reasoning-policy";
import { AssistantResponseProcessor } from "../../src/lib/ai/response/assistant-response-processor";
import { ToolRegistry } from "../../src/lib/ai/tools/registry";
import { z } from "zod";

describe("Response Pipeline — ReasoningFilter", () => {
  it("should strip closed <thinking> and <think> blocks across multiple lines", () => {
    const raw = `<thinking>
I should analyze the patient's semaglutide titration protocol.
Current dose is 0.25mg.
Next step is 0.5mg.
</thinking>
Olá! Analisei seu protocolo e podemos avançar para **0.5 mg** conforme planejado.`;

    const res = ReasoningFilter.filterThinkingTags(raw);
    assert.strictEqual(res.hadReasoningTag, true);
    assert.strictEqual(res.cleanText.includes("<thinking>"), false);
    assert.strictEqual(res.cleanText.includes("analyze the patient"), false);
    assert.ok(res.cleanText.includes("Olá! Analisei seu protocolo e podemos avançar para **0.5 mg**"));
  });

  it("should handle multiple thinking blocks and <think> tags", () => {
    const raw = `<think>Step 1 analysis</think>Primeira resposta.<thinking>Step 2 analysis</thinking>Segunda resposta.`;
    const res = ReasoningFilter.filterThinkingTags(raw);

    assert.strictEqual(res.hadReasoningTag, true);
    assert.strictEqual(res.cleanText, "Primeira resposta.Segunda resposta.");
  });

  it("should strip unclosed trailing thinking tags (interrupted streams)", () => {
    const raw = `Resposta inicial válida.<thinking>Interrupted stream reasoning without close tag`;
    const res = ReasoningFilter.filterThinkingTags(raw);

    assert.strictEqual(res.hadReasoningTag, true);
    assert.strictEqual(res.cleanText.trim(), "Resposta inicial válida.");
  });

  it("should preserve legitimate words like 'thinking' when not enclosed in XML tags", () => {
    const raw = "I am thinking about your nutrition plan and I think it is well balanced.";
    const res = ReasoningFilter.filterThinkingTags(raw);

    assert.strictEqual(res.hadReasoningTag, false);
    assert.strictEqual(res.cleanText, raw);
  });
});

describe("Response Pipeline — MarkdownNormalizer", () => {
  it("should normalize CRLF to LF and trim excessive blank lines while keeping markdown", () => {
    const raw = "Linha 1\r\n\r\n\r\n\r\nLinha 2   \r\n\n\n---\n---\n**Negrito**";
    const normalized = MarkdownNormalizer.normalize(raw);

    assert.strictEqual(normalized.includes("\r\n"), false);
    assert.strictEqual(normalized.includes("\n\n\n"), false);
    assert.ok(normalized.includes("**Negrito**"));
    assert.ok(normalized.includes("---"));
  });
});

describe("Response Pipeline — ReasoningPolicy", () => {
  it("should resolve DISABLED for exploit combo and AUTO for others", () => {
    assert.strictEqual(resolveReasoningPolicy("exploit"), "DISABLED");
    assert.strictEqual(resolveReasoningPolicy("EXPLOIT"), "DISABLED");
    assert.strictEqual(resolveReasoningPolicy("demigod-flash"), "AUTO");
    assert.strictEqual(resolveReasoningPolicy("claude-sonnet"), "AUTO");
    assert.strictEqual(resolveReasoningPolicy(""), "AUTO");
  });
});

describe("Response Pipeline — AssistantResponseProcessor", () => {
  it("should produce clean final answer and metadata without leaking raw reasoning", () => {
    const rawMsg = {
      content: `<thinking>Secret private reasoning calculation</thinking>\n\nSua dieta foi ajustada para **2200 kcal**.`,
      reasoning_content: "Extra reasoning content field from gateway",
    };

    const processed = AssistantResponseProcessor.process(rawMsg, "exploit");

    assert.strictEqual(processed.cleanContent, "Sua dieta foi ajustada para **2200 kcal**.");
    assert.strictEqual(processed.cleanContent.includes("Secret private reasoning"), false);
    assert.strictEqual(processed.cleanContent.includes("<thinking>"), false);
    assert.strictEqual(processed.reasoningSuppressed, true);
    assert.strictEqual(processed.reasoningPolicy, "DISABLED");
    assert.strictEqual(processed.reasoningLeakDetected, true);
  });

  it("should accurately capture reasoning tokens and usage from root completion usage", () => {
    const rawMsg = {
      content: "Prescrição atualizada.",
    };

    const completionUsage = {
      prompt_tokens: 150,
      completion_tokens: 45,
      total_tokens: 195,
      completion_tokens_details: {
        reasoning_tokens: 28,
      },
      prompt_tokens_details: {
        cached_tokens: 50,
      },
    };

    const processed = AssistantResponseProcessor.process(rawMsg, "exploit", "DISABLED", completionUsage);

    assert.strictEqual(processed.reasoningTokenCount, 28);
    assert.strictEqual(processed.usage?.prompt_tokens, 150);
    assert.strictEqual(processed.usage?.completion_tokens, 45);
    assert.strictEqual(processed.usage?.total_tokens, 195);
    assert.strictEqual(processed.usage?.reasoning_tokens, 28);
    assert.strictEqual(processed.usage?.cached_tokens, 50);
    assert.strictEqual(processed.metadata.usage.reasoning_tokens, 28);
  });

  it("should sanitize intermediate assistant messages containing tool_calls before next loop iteration", () => {
    const intermediateToolMsg = {
      role: "assistant",
      content: `<think>
I should invoke healthvault_get_medications to check patient dose before replying.
</think>`,
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "healthvault_get_medications",
            arguments: "{}",
          },
        },
      ],
    };

    const processed = AssistantResponseProcessor.process(intermediateToolMsg, "exploit", "DISABLED");

    // Clean content must NOT contain <think> tags
    assert.strictEqual(processed.cleanContent.includes("<think>"), false);
    assert.strictEqual(processed.cleanContent.includes("I should invoke"), false);
    assert.strictEqual(processed.reasoningLeakDetected, true);
    assert.strictEqual(processed.reasoningSuppressed, true);

    // Simulated message appended to currentMessages for next iteration
    const nextIterationMsg = {
      role: "assistant",
      content: processed.cleanContent || null,
      tool_calls: intermediateToolMsg.tool_calls,
    };

    assert.strictEqual(nextIterationMsg.content, null); // completely stripped of leaked reasoning
    assert.strictEqual(nextIterationMsg.tool_calls.length, 1);
  });
});

describe("Response Pipeline — Tool Schema Zod Conversion", () => {
  it("should correctly resolve optional numbers as type 'number' instead of string", () => {
    const testTool = {
      name: "healthvault_test_schema",
      version: 1,
      description: "Test tool schema conversion",
      category: "system" as any,
      access: "read" as any,
      risk: "low" as any,
      permission: "test",
      requiresApproval: false as any,
      enabled: true,
      inputSchema: z.object({
        required_str: z.string(),
        optional_num: z.number().optional().describe("Optional numeric dose"),
        categories: z.array(z.enum(["a", "b", "c"])).optional(),
      }),
      handler: async () => ({ success: true }),
    };

    const openAITools = ToolRegistry.toOpenAITools([testTool as any]);
    const params = openAITools[0].function.parameters;

    assert.strictEqual(params.properties.required_str.type, "string");
    assert.strictEqual(params.properties.optional_num.type, "number");
    assert.strictEqual(params.properties.categories.type, "array");
    assert.strictEqual(params.properties.categories.items.type, "string");
    assert.deepStrictEqual(params.properties.categories.items.enum, ["a", "b", "c"]);

    assert.deepStrictEqual(params.required, ["required_str"]);
  });
});
