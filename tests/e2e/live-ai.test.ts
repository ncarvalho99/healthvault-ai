import { describe, it } from "node:test";
import assert from "node:assert";
import { OmniRouteProvider } from "../../src/lib/ai/provider/omniroute-provider";
import { AssistantResponseProcessor } from "../../src/lib/ai/response/assistant-response-processor";

describe("Live E2E AI Tests — OmniRoute & Exploit Combo", () => {
  const baseUrl = process.env.E2E_AI_BASE_URL;
  const apiKey = process.env.E2E_AI_API_KEY;
  const model = process.env.E2E_AI_MODEL || "exploit";

  it("should verify live response from exploit suppresses reasoning and returns clean final answer", async (t) => {
    if (!baseUrl || !apiKey) {
      t.skip("Skipping live test: E2E_AI_BASE_URL and E2E_AI_API_KEY environment variables not provided");
      return;
    }

    const completion = await OmniRouteProvider.chatCompletion({
      baseUrl,
      apiKey,
      model,
      messages: [
        {
          role: "user",
          content: "Responda apenas com a palavra 'CONFIRMADO' em negrito (**CONFIRMADO**). Não inclua nenhum raciocínio visível.",
        },
      ],
      reasoningPolicy: "DISABLED",
      timeoutMs: 30000,
    });

    const msg = completion?.choices?.[0]?.message;
    assert.ok(msg, "Completion should return a valid message choice");

    const processed = AssistantResponseProcessor.process(msg, model, "DISABLED");

    // Assert that clean content contains no thinking tags
    assert.strictEqual(/<(think|thinking|reasoning)>/i.test(processed.cleanContent), false);
    assert.ok(processed.cleanContent.includes("CONFIRMADO"));
  });
});
