import { describe, it } from "node:test";
import assert from "node:assert";
import { OmniRouteProvider } from "../../src/lib/ai/provider/omniroute-provider";
import { AssistantResponseProcessor } from "../../src/lib/ai/response/assistant-response-processor";

describe("Live E2E AI Tests — OmniRoute & Exploit Combo", () => {
  const baseUrl = process.env.E2E_AI_BASE_URL;
  const apiKey = process.env.E2E_AI_API_KEY;
  const model = process.env.E2E_AI_MODEL || "exploit";
  const requireLive = process.env.E2E_REQUIRE_LIVE === "true";

  function checkLiveCredentials(t: any): boolean {
    if (!baseUrl || !apiKey) {
      if (requireLive) {
        assert.fail(
          "E2E_REQUIRE_LIVE=true is set, but mandatory E2E credentials (E2E_AI_BASE_URL, E2E_AI_API_KEY) are missing. Test failed by policy."
        );
      } else {
        t.skip("Skipping live test: E2E_AI_BASE_URL and E2E_AI_API_KEY environment variables not provided");
        return false;
      }
    }
    return true;
  }

  it("should verify live response from exploit suppresses reasoning and returns clean final answer", async (t) => {
    if (!checkLiveCredentials(t)) return;

    const completion = await OmniRouteProvider.chatCompletion({
      baseUrl: baseUrl!,
      apiKey: apiKey!,
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

    const processed = AssistantResponseProcessor.process(msg, model, "DISABLED", completion?.usage);

    // Assert that clean content contains no thinking tags
    assert.strictEqual(/<(think|thinking|reasoning)>/i.test(processed.cleanContent), false);
    assert.ok(processed.cleanContent.includes("CONFIRMADO"));
    assert.strictEqual(processed.reasoningSuppressionRequested, true);
  });

  it("should execute full live tool round-trip without reinjecting reasoning into second completion", async (t) => {
    if (!checkLiveCredentials(t)) return;

    const pingTool = {
      type: "function",
      function: {
        name: "healthvault_ping",
        description: "Echo test ping tool for HealthVault runtime verification.",
        parameters: {
          type: "object",
          properties: {
            nonce: { type: "string", description: "Random test token" },
          },
          required: ["nonce"],
        },
      },
    };

    const testNonce = "test-live-" + Date.now();
    const currentMessages: any[] = [
      {
        role: "user",
        content: `Por favor chame a ferramenta healthvault_ping com o nonce "${testNonce}". Não responda com texto livre antes da ferramenta.`,
      },
    ];

    // Iteration 1: First completion triggering tool call
    const firstCompletion = await OmniRouteProvider.chatCompletion({
      baseUrl: baseUrl!,
      apiKey: apiKey!,
      model,
      messages: currentMessages,
      tools: [pingTool],
      toolChoice: "auto",
      reasoningPolicy: "DISABLED",
      timeoutMs: 30000,
    });

    const firstMsg = firstCompletion?.choices?.[0]?.message;
    assert.ok(firstMsg, "First completion must return a message");

    // Process first step through AssistantResponseProcessor (sanitizing intermediate reasoning)
    const firstProcessed = AssistantResponseProcessor.process(
      firstMsg,
      model,
      "DISABLED",
      firstCompletion?.usage
    );

    // Assert that cleaned message content has no thinking tags
    assert.strictEqual(/<(think|thinking|reasoning)>/i.test(firstProcessed.cleanContent), false);

    // If tool calls were emitted, complete the full round-trip
    if (firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {
      const tc = firstMsg.tool_calls[0];

      // Push sanitized content to conversation history (NEVER raw reasoning)
      currentMessages.push({
        role: "assistant",
        content: firstProcessed.cleanContent || null,
        tool_calls: firstMsg.tool_calls,
      });

      // Push simulated tool result
      currentMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({ status: "success", pong: testNonce }),
      });

      // Iteration 2: Second completion synthesizing final answer
      const secondCompletion = await OmniRouteProvider.chatCompletion({
        baseUrl: baseUrl!,
        apiKey: apiKey!,
        model,
        messages: currentMessages,
        reasoningPolicy: "DISABLED",
        timeoutMs: 30000,
      });

      const secondMsg = secondCompletion?.choices?.[0]?.message;
      assert.ok(secondMsg, "Second completion must return a final message");

      const secondProcessed = AssistantResponseProcessor.process(
        secondMsg,
        model,
        "DISABLED",
        secondCompletion?.usage
      );

      // Verify that second step has clean content with NO thinking tags
      assert.strictEqual(/<(think|thinking|reasoning)>/i.test(secondProcessed.cleanContent), false);
      assert.ok(secondProcessed.cleanContent.length > 0);
    }
  });

  it("should run A/B reasoning suppression probe and produce structured diagnostic", async (t) => {
    if (!checkLiveCredentials(t)) return;

    const report = await OmniRouteProvider.testReasoningSuppressionAB(baseUrl!, apiKey!, model, 25000);

    assert.ok(report, "A/B report must be returned");
    assert.strictEqual(report.variants.length, 4);
    assert.ok(report.summary.length > 0);
    assert.ok(["EFFECTIVE", "PARTIAL", "NOT_EFFECTIVE", "REJECTED"].includes(report.upstreamReasoningControl));
  });
});
