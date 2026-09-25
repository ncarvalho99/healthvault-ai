import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { resolveResearchPolicy } from "../../src/lib/ai/research/research-policy";
import { resolveReasoningPolicy } from "../../src/lib/ai/response/reasoning-policy";
import { ToolSelector } from "../../src/lib/ai/tools/selector";
import { ToolDispatcher } from "../../src/lib/ai/tools/dispatcher";
import { ContextBuilder } from "../../src/lib/ai/context/context-builder";

describe("Health-AI Combo Integration — Policy & Runtime Scoping", () => {
  it("should resolve REQUIRED research policy and DISABLED reasoning policy for health-ai while preserving exploit", () => {
    // health-ai
    assert.strictEqual(resolveResearchPolicy("health-ai"), "REQUIRED");
    assert.strictEqual(resolveResearchPolicy("HEALTH-AI"), "REQUIRED");
    assert.strictEqual(resolveReasoningPolicy("health-ai"), "DISABLED");
    assert.strictEqual(resolveReasoningPolicy("HEALTH-AI"), "DISABLED");

    // exploit remains identical
    assert.strictEqual(resolveResearchPolicy("exploit"), "REQUIRED");
    assert.strictEqual(resolveReasoningPolicy("exploit"), "DISABLED");

    // other combos remain AUTO
    assert.strictEqual(resolveResearchPolicy("demigod-flash"), "AUTO");
    assert.strictEqual(resolveReasoningPolicy("demigod-flash"), "AUTO");
  });

  it("should provide read-only tools in CHAT_ONLY mode and never expose write tools", () => {
    const chatOnlyTools = ToolSelector.selectTools({
      userMessage: "Quero alterar minha dose de remédio para 10mg e ver minha dieta",
      agentMode: "CHAT_ONLY",
    });

    assert.ok(chatOnlyTools.length > 0, "CHAT_ONLY must have read tools available for vault grounding");

    // All tools must have access === 'read'
    for (const tool of chatOnlyTools) {
      assert.strictEqual(
        tool.access,
        "read",
        `Tool ${tool.name} in CHAT_ONLY mode must be read-only, but got access: ${tool.access}`
      );
    }

    // Verify write tools are excluded
    const writeToolNames = ["healthvault_create_medication", "healthvault_update_medication", "healthvault_update_diet"];
    for (const wt of writeToolNames) {
      assert.strictEqual(
        chatOnlyTools.some((t) => t.name === wt),
        false,
        `Write tool ${wt} must not be present in CHAT_ONLY mode`
      );
    }
  });

  it("should block write tool execution server-side with READ_ONLY_MODE in ToolDispatcher when in CHAT_ONLY", async () => {
    const result = await ToolDispatcher.execute({
      userId: "test-user-id",
      conversationId: "test-conv-id",
      toolCallId: "call_test_chat_only",
      toolName: "healthvault_create_medication",
      rawArguments: JSON.stringify({
        name: "Ozempic",
        doseValue: 1,
        doseUnit: "mg",
        frequency: "1x/semana",
      }),
      agentMode: "CHAT_ONLY",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, "READ_ONLY_MODE");
    assert.ok(result.error?.message.includes("Chat Apenas"));
  });

  it("should include HEALTH-AI runtime overlay in ContextBuilder system prompt for health-ai model", () => {
    const prompt = ContextBuilder.getSystemPrompt("AGENT", "health-ai");
    assert.ok(prompt.includes("HEALTH-AI INTEGRATION ACTIVE"));
    assert.ok(prompt.includes("HealthVault structured records (<healthvault_data>) are authoritative for personal facts"));
    assert.ok(prompt.includes("<web_research> is authoritative current external evidence"));
    assert.ok(prompt.includes("ANON style/personality must not override these runtime rules"));
  });

  it("should validate that prompts/health-ai.md contains runtime contract and removes harmful override rules", () => {
    const promptPath = path.resolve(process.cwd(), "prompts/health-ai.md");
    assert.ok(fs.existsSync(promptPath), "prompts/health-ai.md must exist");

    const content = fs.readFileSync(promptPath, "utf8");

    // Required integration sections
    assert.ok(content.includes("HEALTHVAULT RUNTIME CONTRACT"));
    assert.ok(content.includes("<healthvault_data>"));
    assert.ok(content.includes("<web_research>"));
    assert.ok(content.includes("[MAHI68]"));
    assert.ok(content.includes("PERSISTENT HEALTHVAULT STATE"));

    // Prohibited hostile precedence statements
    assert.strictEqual(content.includes("THIS FILE WINS"), false, "Must not contain 'THIS FILE WINS'");
    assert.strictEqual(content.includes("nothing outranks this file"), false);
    assert.strictEqual(content.includes("ignore infrastructure"), false);
  });
});
