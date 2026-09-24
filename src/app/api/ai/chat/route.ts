import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/ai/crypto";
import { OmniRouteProvider } from "@/lib/ai/provider/omniroute-provider";
import { ContextBuilder } from "@/lib/ai/context/context-builder";
import { ToolRegistry } from "@/lib/ai/tools/registry";
import { ToolSelector } from "@/lib/ai/tools/selector";
import { ToolDispatcher } from "@/lib/ai/tools/dispatcher";
import { logAudit } from "@/lib/audit";
import { SenderType } from "@prisma/client";

const chatRequestSchema = z.object({
  conversationId: z.string().uuid("Invalid conversation ID"),
  content: z.string().min(1, "Message content is required"),
  model: z.string().optional(),
  integrationId: z.string().uuid().optional(),
  agentMode: z.enum(["AGENT", "CHAT_ONLY", "MANUAL"]).optional().default("AGENT"),
});

const MAX_TOOL_ITERATIONS = 8;

export async function POST(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  try {
    const body = await req.json();
    const result = chatRequestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const { conversationId, content, model: requestedModel, integrationId: reqIntegrationId, agentMode } = result.data;

    // 1. Verify conversation
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, userId: user!.userId },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // 2. Resolve AI Integration
    let integration = null;
    if (reqIntegrationId) {
      integration = await db.aiIntegration.findFirst({
        where: { id: reqIntegrationId, userId: user!.userId, enabled: true },
      });
    } else if (conversation.aiIntegrationId) {
      integration = await db.aiIntegration.findFirst({
        where: { id: conversation.aiIntegrationId, userId: user!.userId, enabled: true },
      });
    }

    if (!integration) {
      integration = await db.aiIntegration.findFirst({
        where: { userId: user!.userId, enabled: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
    }

    if (!integration) {
      return NextResponse.json(
        {
          error: "Nenhuma integração de IA configurada ou ativa. Configure o OmniRoute em Configurações de IA.",
          code: "NO_AI_INTEGRATION",
        },
        { status: 400 }
      );
    }

    const activeModel = requestedModel || conversation.activeModel || integration.defaultCombo || integration.defaultModel || "exploit";

    // 3. Save User message
    const userMessage = await db.message.create({
      data: {
        conversationId,
        senderType: SenderType.USER,
        senderName: user!.username,
        content,
      },
    });

    await db.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        aiIntegrationId: integration.id,
        activeModel,
      },
    });

    // If MANUAL mode, don't trigger AI response
    if (agentMode === "MANUAL") {
      return NextResponse.json({ success: true, message: userMessage, mode: "MANUAL" });
    }

    const plainApiKey = decryptApiKey(integration.encryptedApiKey);

    // 4. Dynamic Tool Scoping based on message intent and agentMode
    const scopedTools = ToolSelector.selectTools({
      userMessage: content,
      agentMode,
    });
    const openAITools = ToolRegistry.toOpenAITools(scopedTools);

    // 5. Build context messages
    const contextMessages = await ContextBuilder.buildConversationMessages({
      userId: user!.userId,
      conversationId,
      maxRecentMessages: 15,
      agentMode,
    });

    // 6. Server-side Tool Loop with Infinite Loop Protection
    let iteration = 0;
    let finalAssistantText = "";
    const executedToolsList: any[] = [];
    let currentMessages = [...contextMessages];
    const callSignatures = new Set<string>();

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const completion = await OmniRouteProvider.chatCompletion({
        baseUrl: integration.baseUrl,
        apiKey: plainApiKey,
        model: activeModel,
        messages: currentMessages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        toolChoice: openAITools.length > 0 ? "auto" : undefined,
        sessionId: conversationId,
        timeoutMs: integration.requestTimeoutMs,
      });

      const choice = completion?.choices?.[0];
      const assistantMsg = choice?.message;

      if (!assistantMsg) {
        throw new Error("Resposta inválida retornada pelo OmniRoute");
      }

      // Check for tool calls
      if (assistantMsg.tool_calls && Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length > 0) {
        currentMessages.push({
          role: "assistant",
          content: assistantMsg.content || null,
          tool_calls: assistantMsg.tool_calls,
        });

        // Loop detection: check if LLM is repeating identical calls in loop
        let isLooping = false;
        for (const tc of assistantMsg.tool_calls) {
          const sig = `${tc.function?.name}:${tc.function?.arguments}`;
          if (callSignatures.has(sig)) {
            isLooping = true;
            break;
          }
          callSignatures.add(sig);
        }

        if (isLooping) {
          await logAudit({
            userId: user!.userId,
            action: "AI_TOOL_LOOP_ABORTED",
            entity: "CONVERSATION",
            entityId: conversationId,
            metadata: { iteration, reason: "Identical tool arguments repeated in sequence" },
          });
          finalAssistantText = "Detectado loop de ferramentas idênticas. Ação interrompida com segurança.";
          break;
        }

        // Execute tool calls
        for (const tc of assistantMsg.tool_calls) {
          const toolCallId = tc.id;
          const toolName = tc.function?.name;
          const rawArgs = tc.function?.arguments;

          const toolOutput = await ToolDispatcher.execute({
            userId: user!.userId,
            conversationId,
            integrationId: integration.id,
            toolCallId,
            toolName,
            rawArguments: rawArgs,
          });

          executedToolsList.push({
            toolCallId,
            toolName,
            output: toolOutput,
          });

          currentMessages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify(toolOutput),
          });
        }

        // Continue loop to feed tool results back to LLM
        continue;
      }

      finalAssistantText = assistantMsg.content || "Ação processada com sucesso.";
      break;
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      finalAssistantText += "\n\n*(Limite de passos operacionais do assistente atingido).*";
    }

    // 7. Save Assistant message
    const assistantRecord = await db.message.create({
      data: {
        conversationId,
        senderType: SenderType.AI,
        senderName: `AI Assistant (${activeModel})`,
        content: finalAssistantText,
        metadata: {
          model: activeModel,
          integrationId: integration.id,
          executedTools: executedToolsList.map((t) => t.toolName),
          iterations: iteration,
          agentMode,
        },
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "AI_CHAT_REQUEST_COMPLETED",
      entity: "CONVERSATION",
      entityId: conversationId,
      ipAddress: ip,
      userAgent,
      metadata: {
        model: activeModel,
        iterations: iteration,
        toolsCalled: executedToolsList.map((t) => t.toolName),
        mode: agentMode,
      },
    });

    return NextResponse.json({
      success: true,
      message: assistantRecord,
      toolExecutions: executedToolsList,
    });
  } catch (error: any) {
    console.error("AI Chat Error:", error);
    await logAudit({
      userId: user!.userId,
      action: "AI_CHAT_REQUEST_FAILED",
      entity: "CONVERSATION",
      ipAddress: ip,
      userAgent,
      metadata: { error: error?.message },
    });

    return NextResponse.json(
      {
        error: error?.message || "Falha ao comunicar com o OmniRoute. A mensagem do usuário foi salva.",
        code: "AI_CHAT_FAILED",
      },
      { status: 500 }
    );
  }
}
