import { describe, it } from "node:test";
import assert from "node:assert";
import { ResearchOrchestrator } from "../../src/lib/ai/research/research-orchestrator";
import { OmniRouteProvider } from "../../src/lib/ai/provider/omniroute-provider";
import { AssistantResponseProcessor } from "../../src/lib/ai/response/assistant-response-processor";

describe("Live E2E Web Research — OmniRoute Gateway & Exploit Grounded Answer", () => {
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
        t.skip("Skipping live E2E web research test: E2E_AI_BASE_URL and E2E_AI_API_KEY environment variables not provided");
        return false;
      }
    }
    return true;
  }

  it("should execute full live flow: ResearchOrchestrator -> OmniRoute /v1/search (firecrawl/ollama) -> sources -> exploit grounded response", async (t) => {
    if (!checkLiveCredentials(t)) return;

    const query = "Qual é o status clínico atual da retatrutida?";

    // 1. Execute live Web Research via ResearchOrchestrator
    const researchResult = await ResearchOrchestrator.execute({
      userMessage: query,
      modelId: model,
      omnirouteBaseUrl: baseUrl!,
      omnirouteApiKey: apiKey!,
    });

    // Validations on research retrieval:
    assert.strictEqual(researchResult.policy, "REQUIRED", "Policy for exploit must be REQUIRED");
    assert.strictEqual(researchResult.status, "SUCCESS", "Research retrieval must succeed");
    assert.ok(
      researchResult.sources.length >= 1,
      `Expected at least 1 source, got ${researchResult.sources.length}`
    );

    // Provider real identificado (omniroute, firecrawl, ollama, or searxng)
    assert.ok(
      researchResult.provider.includes("omniroute") ||
        researchResult.provider.includes("searxng") ||
        researchResult.provider.includes("firecrawl"),
      `Provider real must be identified: got ${researchResult.provider}`
    );

    // Pelo menos uma URL válida retornada
    const firstSource = researchResult.sources[0];
    assert.ok(firstSource.url, "Source must have a url");
    assert.ok(
      firstSource.url.startsWith("http://") || firstSource.url.startsWith("https://"),
      `Source URL must be valid HTTP(S): got ${firstSource.url}`
    );

    // 2. Synthesize Grounded Answer via exploit combo using retrieved sources
    assert.ok(researchResult.contextBlock, "Context block must be built");

    const messages = [
      {
        role: "system",
        content: `You are operating inside HealthVault. Use the following retrieved web research to answer the user query.\n\n${researchResult.contextBlock}`,
      },
      {
        role: "user",
        content: query,
      },
    ];

    const completion = await OmniRouteProvider.chatCompletion({
      baseUrl: baseUrl!,
      apiKey: apiKey!,
      model,
      messages,
      reasoningPolicy: "DISABLED",
      timeoutMs: 40000,
    });

    const choice = completion?.choices?.[0];
    const msg = choice?.message;
    assert.ok(msg, "Completion must return a valid message");

    // 3. Process via AssistantResponseProcessor
    const processed = AssistantResponseProcessor.process(
      msg,
      model,
      "DISABLED",
      completion?.usage
    );

    // Validar: nenhuma tag <thinking>, <think>, ou <reasoning>
    assert.strictEqual(
      /<(think|thinking|reasoning)>/i.test(processed.cleanContent),
      false,
      "Response must not leak <thinking> or <think> tags"
    );

    // Validar: nenhuma URL/IP interno na resposta ao usuário
    assert.strictEqual(
      /172\.\d+\.\d+\.\d+/.test(processed.cleanContent),
      false,
      "Response must not leak internal 172.x IP"
    );
    assert.strictEqual(
      /100\.\d+\.\d+\.\d+/.test(processed.cleanContent),
      false,
      "Response must not leak internal 100.x IP"
    );
    assert.strictEqual(
      /8888|20128/.test(processed.cleanContent),
      false,
      "Response must not leak internal ports 8888 or 20128"
    );

    // Model grounded response should address retatrutide
    assert.ok(
      processed.cleanContent.toLowerCase().includes("retatrutid"),
      "Response should mention retatrutide based on research"
    );
  });

  it("should fail-closed safely when all real search providers fail or return 0 results", async (t) => {
    if (!checkLiveCredentials(t)) return;

    // Simulate failure by executing with an unreachable OmniRoute search URL
    const failResult = await ResearchOrchestrator.execute({
      userMessage: "Qual é o status clínico atual da retatrutida?",
      modelId: model,
      omnirouteBaseUrl: "http://127.0.0.1:59999/v1", // invalid port
      omnirouteApiKey: "dummy-key",
      providerOverride: "omniroute",
    });

    assert.strictEqual(failResult.status, "NO_SOURCES");
    assert.strictEqual(failResult.policy, "REQUIRED");
    assert.ok(
      failResult.reasonCode === "NO_RAW_RESULTS" ||
        failResult.reasonCode === "ALL_PROVIDERS_FAILED" ||
        failResult.reasonCode === "NO_TRUSTED_RESULTS",
      `Expected fail-closed reason code, got: ${failResult.reasonCode}`
    );
    assert.strictEqual(failResult.sources.length, 0);
  });
});
