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
import {
  createTurnMutationState,
  recordTurnMutation,
  computePendingBaselineConflict,
  resolveWriteScope,
  PendingBaselineConflict,
} from "@/lib/ai/tools/write-intent-guard";
import { resolveReasoningPolicy } from "@/lib/ai/response/reasoning-policy";
import { AssistantResponseProcessor } from "@/lib/ai/response/assistant-response-processor";
import { resolveResearchPolicy as resolveWebResearchPolicy } from "@/lib/ai/research/research-policy";
import { ResearchOrchestrator } from "@/lib/ai/research/research-orchestrator";
import { EvidenceConsistencyGate } from "@/lib/ai/response/evidence-consistency-gate";
import { isHealthAiModel } from "@/lib/ai/models/model-identification";
import { logAudit } from "@/lib/audit";
import { SenderType, RecommendationStatus, SourceType } from "@prisma/client";
import { planFromDietArgs, upsertCurrentPlanSection } from "@/lib/services/protocol-notes";

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
  let userMessage: any = null;

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
      // Fallback to the system integration: only integrations owned by an ADMIN are shared,
      // never another regular user's integration/API key
      integration = await db.aiIntegration.findFirst({
        where: { enabled: true, user: { role: "ADMIN" } },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
    }

    if (!integration) {
      return NextResponse.json(
        {
          error: "Nenhuma integração de IA configurada ou ativa. Contate o administrador do sistema.",
          code: "NO_AI_INTEGRATION",
        },
        { status: 400 }
      );
    }

    const activeModel = requestedModel || conversation.activeModel || integration.defaultCombo || integration.defaultModel || "exploit";

    // Enforce model authorization for standard users
    const dbUser = await db.user.findUnique({
      where: { id: user!.userId },
      select: { role: true, allowedModels: true },
    });

    if (dbUser?.role === "USER") {
      const allowed = new Set(dbUser.allowedModels || []);
      if (!allowed.has(activeModel)) {
        return NextResponse.json(
          {
            error: `Você não tem permissão para utilizar o modelo '${activeModel}'. Solicite autorização a um administrador.`,
            code: "MODEL_NOT_AUTHORIZED",
          },
          { status: 403 }
        );
      }
    }

    // 3. Save User message
    userMessage = await db.message.create({
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
    const correlationId = "hv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const reasoningPolicy = resolveReasoningPolicy(activeModel);

    // 3.5 Previous assistant turn (offer being confirmed + pending weight conflict) and authoritative Vault weight
    const previousAssistantRecord = await db.message.findFirst({
      where: { conversationId, senderType: SenderType.AI },
      orderBy: { createdAt: "desc" },
      select: { content: true, metadata: true },
    });
    const previousAssistantMessage = previousAssistantRecord?.content || undefined;
    const previousPendingConflict =
      ((previousAssistantRecord?.metadata as any)?.pendingBaselineConflict as PendingBaselineConflict | undefined) || null;
    const latestBodyMetric = await db.bodyMetric.findFirst({
      where: { userId: user!.userId },
      orderBy: { date: "desc" },
      select: { weightKg: true },
    });
    const vaultWeightKg = typeof latestBodyMetric?.weightKg === "number" ? latestBodyMetric.weightKg : null;

    // 4. Dynamic Tool Scoping based on message intent and agentMode
    const scopedTools = ToolSelector.selectTools({
      userMessage: content,
      previousAssistantMessage,
      agentMode,
    });
    const openAITools = ToolRegistry.toOpenAITools(scopedTools);

    // 4.5. Web-First Research Preflight (Mandatory for 'exploit', auto for others)
    const webResearchPolicy = resolveWebResearchPolicy(activeModel);
    const researchResult = await ResearchOrchestrator.execute({
      userId: user!.userId,
      userMessage: content,
      modelId: activeModel,
      agentMode,
      omnirouteBaseUrl: integration.baseUrl,
      omnirouteApiKey: plainApiKey,
    });

    if (researchResult.status !== "SKIPPED") {
      await logAudit({
        userId: user!.userId,
        action: "AI_WEB_RESEARCH_EXECUTED",
        entity: "CONVERSATION",
        entityId: conversationId,
        metadata: {
          runId: researchResult.runId,
          model: activeModel,
          policy: webResearchPolicy,
          provider: researchResult.provider,
          providersAttempted: researchResult.providersAttempted,
          queryHash: researchResult.queryHash,
          rawResultCount: researchResult.rawResultCount,
          sourcesCount: researchResult.sources.length,
          latencyMs: researchResult.latencyMs,
          status: researchResult.status,
          reasonCode: researchResult.reasonCode,
          vaultResolutionUsed: researchResult.vaultResolutionUsed,
          resolvedEntityTypes: researchResult.resolvedEntityTypes,
          resolvedEntityCount: researchResult.resolvedEntityCount,
          hasAmbiguity: researchResult.hasAmbiguity,
        },
      });
    }

    // Fail-Closed Policy Enforcement for 'exploit' / REQUIRED:
    // If external research was required but failed or returned no sources,
    // do NOT fall back to the model's stale training memory.
    if (
      webResearchPolicy === "REQUIRED" &&
      (researchResult.status === "NO_PROVIDER" ||
        researchResult.status === "NO_SOURCES" ||
        researchResult.status === "FAILED")
    ) {
      const controlledFailMessage = `Não consegui obter fontes atuais e confiáveis para validar esta resposta no momento.

O modo **${activeModel}** opera sob a política **Web-First (REQUIRED)** e exige evidências científicas externas recentes para formular respostas sobre fatos clínicos, medicamentos e diretrizes, não tendo autorização para responder apenas a partir de memória interna potencialmente desatualizada.

> *Dica:* Tente reformular a consulta com termos específicos ou tente novamente em alguns instantes. Se o problema persistir, verifique a saúde da integração de pesquisa em **Configurações > Runtime**.`;

      const assistantFailRecord = await db.message.create({
        data: {
          conversationId,
          senderType: SenderType.AI,
          senderName: `AI Assistant (${activeModel})`,
          content: controlledFailMessage,
          metadata: {
            model: activeModel,
            integrationId: integration.id,
            agentMode,
            correlationId,
            researchFailedClosed: true,
            researchPolicy: webResearchPolicy,
            researchStatus: researchResult.status,
            reasonCode: researchResult.reasonCode,
            rawResultCount: researchResult.rawResultCount,
            rankedResultCount: researchResult.rankedResultCount,
            trustedResultCount: researchResult.trustedResultCount,
            providersAttempted: researchResult.providersAttempted,
            researchError: researchResult.errorMessage,
          },
        },
      });

      return NextResponse.json({
        success: true,
        userMessage,
        message: assistantFailRecord,
        toolExecutions: [],
        research: {
          used: false,
          policy: webResearchPolicy,
          status: researchResult.status,
          reasonCode: researchResult.reasonCode,
          error: researchResult.errorMessage,
        },
      });
    }

    // 5. Build context messages (Order: System -> HealthVault Data -> Web Research -> History -> Recent)
    const contextMessages = await ContextBuilder.buildConversationMessages({
      userId: user!.userId,
      conversationId,
      maxRecentMessages: 15,
      agentMode,
      researchContextBlock: researchResult.contextBlock,
      activeModel,
    });

    // 6. Server-side Tool Loop with Infinite Loop Protection
    let iteration = 0;
    let finalAssistantText = "";
    let finalResponseMetadata: Record<string, any> = {};
    const executedToolsList: any[] = [];
    let currentMessages = [...contextMessages];
    const callSignatures = new Set<string>();
    // Writes persisted during this turn (across tool iterations); resolves weight baseline conflicts by real state
    const turnMutationState = createTurnMutationState();
    // Arguments of the last diet write actually persisted this turn (documents the plan in the protocol)
    let lastPersistedDietArgs: any = null;
    let hasRegeneratedForConsistency = false;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      const requestId = `${correlationId}_${iteration}_${crypto.randomUUID().slice(0, 8)}`;

      const completion = await OmniRouteProvider.chatCompletion({
        baseUrl: integration.baseUrl,
        apiKey: plainApiKey,
        model: activeModel,
        messages: currentMessages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        toolChoice: openAITools.length > 0 ? "auto" : undefined,
        sessionId: conversationId,
        requestId,
        correlationId,
        reasoningPolicy,
        timeoutMs: integration.requestTimeoutMs,
      });

      const choice = completion?.choices?.[0];
      const assistantMsg = choice?.message;

      if (!assistantMsg) {
        throw new Error("Resposta inválida retornada pelo OmniRoute");
      }

      // Check for tool calls
      if (assistantMsg.tool_calls && Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length > 0) {
        // Hardening: Sanitize reasoning from intermediate assistant message before injecting into next iteration
        const processedToolStep = AssistantResponseProcessor.process(
          assistantMsg,
          activeModel,
          reasoningPolicy,
          completion?.usage
        );

        currentMessages.push({
          role: "assistant",
          content: processedToolStep.cleanContent || null,
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
            metadata: { iteration, correlationId, reason: "Identical tool arguments repeated in sequence" },
          });
          finalAssistantText = "Detectado loop de ferramentas idênticas. Ação interrompida com segurança.";
          break;
        }

        // Order tool calls deterministically: metrics -> meds -> diet -> recommendations
        const toolDependencyPriority = (name: string) => {
          if (name.includes("metric")) return 1;
          if (name.includes("medication")) return 2;
          if (name.includes("diet")) return 3;
          if (name.includes("recommendation")) return 4;
          return 5;
        };
        const orderedToolCalls = [...assistantMsg.tool_calls].sort(
          (a, b) => toolDependencyPriority(a.function?.name || "") - toolDependencyPriority(b.function?.name || "")
        );

        // Execute tool calls
        for (const tc of orderedToolCalls) {
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
            agentMode,
            userMessage: content,
            previousAssistantMessage,
            vaultWeightKg,
            pendingBaselineConflict: previousPendingConflict,
            turnMutationState,
          });

          recordTurnMutation(turnMutationState, toolName, toolOutput);
          if (
            (toolName === "healthvault_create_diet" || toolName === "healthvault_update_diet") &&
            toolOutput.success &&
            !toolOutput.requires_approval
          ) {
            try {
              lastPersistedDietArgs = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
            } catch {
              lastPersistedDietArgs = null;
            }
          }

          // A call blocked only by an unresolved baseline conflict may be retried after the metric is persisted
          if (toolOutput.error?.code === "BASELINE_CONFLICT") {
            callSignatures.delete(`${toolName}:${rawArgs}`);
          }

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

      // Final response processing through AssistantResponseProcessor pipeline
      const processed = AssistantResponseProcessor.process(assistantMsg, activeModel, reasoningPolicy, completion?.usage);
      finalAssistantText = processed.cleanContent || "Ação processada com sucesso.";
      finalResponseMetadata = processed.metadata;

      // 6.5 Evidence Consistency Gate: validate clinical consistency before accepting response
      const shouldRunConsistencyGate =
        (isHealthAiModel(activeModel) || (researchResult.status === "SUCCESS" && researchResult.sources.length > 0)) &&
        !hasRegeneratedForConsistency &&
        iteration < MAX_TOOL_ITERATIONS;

      if (shouldRunConsistencyGate) {
        const vaultBlock = contextMessages.find(
          (m) => m.role === "system" && m.content?.includes("<healthvault_data>")
        )?.content;

        const consistency = EvidenceConsistencyGate.evaluate({
          userMessage: content,
          assistantText: finalAssistantText,
          sources: researchResult.sources || [],
          vaultContextBlock: vaultBlock,
          conversationHistory: currentMessages,
        });

        if (!consistency.isValid) {
          hasRegeneratedForConsistency = true;
          await logAudit({
            userId: user!.userId,
            action: "AI_EVIDENCE_CONSISTENCY_GATE_FAILED",
            entity: "CONVERSATION",
            entityId: conversationId,
            metadata: {
              violations: consistency.violations,
              model: activeModel,
              correlationId,
            },
          });

          // Inject correction feedback and run single regeneration
          currentMessages.push({
            role: "assistant",
            content: finalAssistantText,
          });
          currentMessages.push({
            role: "system",
            content: `[CLINICAL EVIDENCE CORRECTION REQUIRED]:
${consistency.remediationPrompt}`,
          });

          continue;
        }
      }
      break;
    }

    if (iteration >= MAX_TOOL_ITERATIONS) {
      finalAssistantText += "\n\n*(Limite de passos operacionais do assistente atingido).*";
    }

    // 6.8 When the user explicitly authorized both the plan and its protocol/recommendation but the model
    // did not record the protocol, document the persisted plan as a protocol version. Dispatched through the
    // regular tool pipeline so intent guard, write policy and audit still apply.
    if (
      turnMutationState.dietUpdatedThisTurn &&
      !turnMutationState.recommendationHandledThisTurn &&
      resolveWriteScope(content, previousAssistantMessage).domains.has("recommendations")
    ) {
      // Target: only an AI protocol already versioned in this conversation; otherwise a new protocol.
      // Never guess among unrelated protocols, and never version user-authored notes.
      const targetRecommendation = await db.recommendation.findFirst({
        where: {
          userId: user!.userId,
          status: { notIn: [RecommendationStatus.ARCHIVED, RecommendationStatus.USER_NOTE] },
          sourceType: SourceType.AI_AGENT,
          versions: { some: { conversationId } },
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, notes: true },
      });

      const plan = planFromDietArgs(
        lastPersistedDietArgs,
        turnMutationState.updatedWeightKg ?? vaultWeightKg
      );
      const reason = plan.reason ? `Plano nutricional atualizado: ${plan.reason}` : "Plano nutricional atualizado nesta conversa";
      const autoToolName = targetRecommendation ? "healthvault_update_recommendation" : "healthvault_create_recommendation";
      const autoArgs = targetRecommendation
        ? {
            recommendation_id: targetRecommendation.id,
            notes: upsertCurrentPlanSection(targetRecommendation.notes, plan),
            reason,
          }
        : {
            title: "Protocolo Nutricional",
            notes: upsertCurrentPlanSection(null, plan),
            reason,
          };
      const autoToolCallId = `auto_rec_${correlationId}`;
      const autoOutput = await ToolDispatcher.execute({
        userId: user!.userId,
        conversationId,
        integrationId: integration.id,
        toolCallId: autoToolCallId,
        toolName: autoToolName,
        rawArguments: JSON.stringify(autoArgs),
        agentMode,
        userMessage: content,
        previousAssistantMessage,
        vaultWeightKg,
        pendingBaselineConflict: previousPendingConflict,
        turnMutationState,
      });
      recordTurnMutation(turnMutationState, autoToolName, autoOutput);
      executedToolsList.push({ toolCallId: autoToolCallId, toolName: autoToolName, output: autoOutput });
    }

    // Unresolved weight conflict carried to the next turn (cleared once the Vault matches or is updated)
    const pendingBaselineConflict = computePendingBaselineConflict(
      content,
      vaultWeightKg,
      previousPendingConflict,
      turnMutationState
    );

    // 7. Save Assistant message with clean sanitized content
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
          toolExecutions: executedToolsList,
          iterations: iteration,
          agentMode,
          correlationId,
          pendingBaselineConflict: pendingBaselineConflict
            ? { reportedWeightKg: pendingBaselineConflict.reportedWeightKg, vaultWeightKg: pendingBaselineConflict.vaultWeightKg }
            : null,
          ...finalResponseMetadata,
          ...(researchResult.status === "SUCCESS" && researchResult.sources.length > 0
            ? {
                researchUsed: true,
                researchRunId: researchResult.runId,
                researchPolicy: webResearchPolicy,
                researchProvider: researchResult.provider,
                researchSourcesCount: researchResult.sources.length,
                vaultResolutionUsed: researchResult.vaultResolutionUsed,
                resolvedEntityTypes: researchResult.resolvedEntityTypes,
                resolvedEntityCount: researchResult.resolvedEntityCount,
                hasAmbiguity: researchResult.hasAmbiguity,
                ambiguousItems: researchResult.ambiguousItems,
                sources: researchResult.sources.map((s) => ({
                  id: s.id,
                  title: s.title,
                  url: s.url,
                  domain: s.sourceDomain || "unknown",
                  tier: s.tier,
                  isAnecdotal: s.isAnecdotal,
                  publishedAt: s.publishedAt,
                  retrievedAt: s.retrievedAt,
                })),
              }
            : {}),
        },
      },
    });

    // Associate assistant messageId with all pending/executed tool executions from this turn
    const executionIds = executedToolsList
      .map((t) => t.output?.execution_id)
      .filter(Boolean);
    if (executionIds.length > 0) {
      await db.aiToolExecution.updateMany({
        where: { id: { in: executionIds } },
        data: { messageId: assistantRecord.id },
      });
    }

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
        correlationId,
        reasoningSuppressed: finalResponseMetadata.reasoningSuppressed,
      },
    });

    return NextResponse.json({
      success: true,
      userMessage,
      message: assistantRecord,
      toolExecutions: executedToolsList,
      research: {
        used: researchResult.status === "SUCCESS" && researchResult.sources.length > 0,
        policy: webResearchPolicy,
        status: researchResult.status,
        reasonCode: researchResult.reasonCode,
        provider: researchResult.provider,
        sourcesCount: researchResult.sources.length,
        vaultResolutionUsed: researchResult.vaultResolutionUsed,
        resolvedEntityTypes: researchResult.resolvedEntityTypes,
        resolvedEntityCount: researchResult.resolvedEntityCount,
        hasAmbiguity: researchResult.hasAmbiguity,
        ambiguousItems: researchResult.ambiguousItems,
      },
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
        userMessage: typeof userMessage !== "undefined" ? userMessage : undefined,
      },
      { status: 500 }
    );
  }
}
