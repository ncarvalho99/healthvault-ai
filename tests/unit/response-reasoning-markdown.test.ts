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
