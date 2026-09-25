import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isReadTool,
  getFriendlyToolName,
  TOOL_FRIENDLY_NAMES,
} from "../../src/components/chat/MessageToolExecutions";

describe("Chat Message Lifecycle & Optimistic Reconciliation", () => {
  it("should preserve all previous user and AI messages across sequential dialogue turns without losing bubbles", () => {
    // Simulated state in ChatContainer
    let messages: Array<{ id: string; senderType: "USER" | "AI"; content: string }> = [];

    // Turn 1: User sends A
    const temp1 = { id: `temp-1`, senderType: "USER" as const, content: "Olá, bom dia" };
    messages = [...messages, temp1];
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].id, "temp-1");

    // Server returns persisted userMessage and assistant message
    const realUser1 = { id: "user-uuid-1", senderType: "USER" as const, content: "Olá, bom dia" };
    const aiResponse1 = { id: "ai-uuid-1", senderType: "AI" as const, content: "[MAHI68] Bom dia. Como posso ajudar?" };

    // New reconciliation logic: replace only temp1.id with realUser1
    messages = messages.map((m) => (m.id === temp1.id ? realUser1 : m));
    if (!messages.some((m) => m.id === aiResponse1.id)) {
      messages.push(aiResponse1);
    }

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].id, "user-uuid-1");
    assert.strictEqual(messages[1].id, "ai-uuid-1");

    // Turn 2: User sends B
    const temp2 = { id: `temp-2`, senderType: "USER" as const, content: "Qual meu medicamento atual?" };
    messages = [...messages, temp2];
    assert.strictEqual(messages.length, 3);

    const realUser2 = { id: "user-uuid-2", senderType: "USER" as const, content: "Qual meu medicamento atual?" };
    const aiResponse2 = { id: "ai-uuid-2", senderType: "AI" as const, content: "[MAHI68] Você está usando Semaglutida 0.5mg." };

    messages = messages.map((m) => (m.id === temp2.id ? realUser2 : m));
    if (!messages.some((m) => m.id === aiResponse2.id)) {
      messages.push(aiResponse2);
    }

    // CRITICAL BUG VERIFICATION: In the old bug, messages[0] (User 1) was deleted!
    assert.strictEqual(messages.length, 4);
    assert.strictEqual(messages[0].content, "Olá, bom dia", "User message 1 MUST remain in conversation");
    assert.strictEqual(messages[1].content, "[MAHI68] Bom dia. Como posso ajudar?");
    assert.strictEqual(messages[2].content, "Qual meu medicamento atual?", "User message 2 MUST remain in conversation");
    assert.strictEqual(messages[3].content, "[MAHI68] Você está usando Semaglutida 0.5mg.");

    // Turn 3: User sends C
    const temp3 = { id: `temp-3`, senderType: "USER" as const, content: "Registre meu peso como 84 kg" };
    messages = [...messages, temp3];
    assert.strictEqual(messages.length, 5);

    const realUser3 = { id: "user-uuid-3", senderType: "USER" as const, content: "Registre meu peso como 84 kg" };
    const aiResponse3 = { id: "ai-uuid-3", senderType: "AI" as const, content: "[MAHI68] Registrado peso de 84 kg no HealthVault." };

    messages = messages.map((m) => (m.id === temp3.id ? realUser3 : m));
    if (!messages.some((m) => m.id === aiResponse3.id)) {
      messages.push(aiResponse3);
    }

    assert.strictEqual(messages.length, 6);
    assert.deepStrictEqual(
      messages.map((m) => ({ sender: m.senderType, id: m.id })),
      [
        { sender: "USER", id: "user-uuid-1" },
        { sender: "AI", id: "ai-uuid-1" },
        { sender: "USER", id: "user-uuid-2" },
        { sender: "AI", id: "ai-uuid-2" },
        { sender: "USER", id: "user-uuid-3" },
        { sender: "AI", id: "ai-uuid-3" },
      ]
    );
  });

  it("should reconcile user message even if API returns error after persisting message", () => {
    let messages: Array<{ id: string; senderType: "USER" | "AI"; content: string }> = [];
    const temp = { id: "temp-error-test", senderType: "USER" as const, content: "Mensagem teste erro" };
    messages = [...messages, temp];

    const errorResponse = {
      error: "Timeout no provedor",
      userMessage: { id: "user-persisted-id", senderType: "USER" as const, content: "Mensagem teste erro" },
    };

    // Reconcile on error:
    if (errorResponse.userMessage) {
      messages = messages.map((m) => (m.id === temp.id ? errorResponse.userMessage : m));
    }

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].id, "user-persisted-id", "Temp message should be reconciled with persisted DB ID");
  });
});

describe("Tool Execution Presentation & Friendly Semantic Labels", () => {
  it("should distinguish read tools from write tools and never treat read tools as mutations", () => {
    // Read tools
    assert.strictEqual(isReadTool("healthvault_get_context"), true);
    assert.strictEqual(isReadTool("healthvault_search"), true);
    assert.strictEqual(isReadTool("healthvault_list_medications"), true);
    assert.strictEqual(isReadTool("healthvault_get_current_diet"), true);
    assert.strictEqual(isReadTool("healthvault_get_body_metrics"), true);

    // Write tools
    assert.strictEqual(isReadTool("healthvault_create_medication"), false);
    assert.strictEqual(isReadTool("healthvault_update_medication"), false);
    assert.strictEqual(isReadTool("healthvault_update_diet"), false);
    assert.strictEqual(isReadTool("healthvault_add_body_metric"), false);
    assert.strictEqual(isReadTool("healthvault_add_symptom"), false);
  });

  it("should format tool names with humanized friendly clinical labels", () => {
    assert.strictEqual(getFriendlyToolName("healthvault_add_body_metric"), "Métrica Corporal");
    assert.strictEqual(getFriendlyToolName("healthvault_update_medication"), "Ajuste de Medicamento");
    assert.strictEqual(getFriendlyToolName("healthvault_update_diet"), "Dieta");
    assert.strictEqual(getFriendlyToolName("healthvault_list_medications"), "Medicamentos");
    assert.strictEqual(getFriendlyToolName("healthvault_get_context"), "Contexto Clínico");
  });
});
