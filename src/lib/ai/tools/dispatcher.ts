import { db } from "../../db";
import { ToolRegistry } from "./registry";
import { PermissionEngine } from "./permissions";
import { ApprovalEngine } from "./approvals";
import { IdempotencyEngine } from "./idempotency";
import { ToolExecutionContext, ToolExecutionResult } from "./types";
import { logAudit } from "../../audit";

export class ToolDispatcher {
  /**
   * Retrieves or initializes the user's AI Write Policy
   */
  static async getUserWritePolicy(userId: string) {
    return ApprovalEngine.getUserWritePolicy(userId);
  }

  /**
   * Executes a tool call with strict authorization, schema validation, policy check, and audit trail.
   */
  static async execute(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const { userId, conversationId, messageId, integrationId, toolCallId, toolName, rawArguments } = context;

    // 1. Lookup tool in ToolRegistry
    const tool = ToolRegistry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Ferramenta '${toolName}' não existe ou não está autorizada no HealthVault.`,
        },
      };
    }

    // 1.5 Defense-in-depth: Block write operations when operating in CHAT_ONLY mode
    if (context.agentMode === "CHAT_ONLY" && tool.access !== "read") {
      try {
        await logAudit({
          userId,
          action: "AI_TOOL_WRITE_BLOCKED_CHAT_ONLY",
          entity: "AI_TOOL",
          entityId: toolCallId,
          metadata: { toolName, access: tool.access, conversationId },
        });
      } catch {
        // Safe in unit test runs without active database
      }
      return {
        success: false,
        error: {
          code: "READ_ONLY_MODE",
          message: "Operações de alteração ou gravação estão desabilitadas no modo Chat Apenas (CHAT_ONLY). Apenas consultas de leitura são autorizadas.",
        },
      };
    }

    try {
      await logAudit({
        userId,
        action: "AI_TOOL_REQUESTED",
        entity: "AI_TOOL",
        entityId: toolCallId,
        metadata: { toolName, conversationId },
      });
    } catch {
      // Safe in unit test runs without active database
    }

    // 2. Idempotency Check
    const cachedResult = await IdempotencyEngine.getExistingResult(context);
    if (cachedResult) {
      return cachedResult;
    }

    // 3. Parse arguments
    let args: any = {};
    if (typeof rawArguments === "string") {
      try {
        args = JSON.parse(rawArguments);
      } catch {
        return {
          success: false,
          error: {
            code: "INVALID_JSON_ARGUMENTS",
            message: "Os argumentos enviados pela IA não formam um JSON válido.",
          },
        };
      }
    } else {
      args = rawArguments || {};
    }

    // 4. Permission Engine Check
    const perm = PermissionEngine.checkPermission(tool, context);
    if (!perm.allowed) {
      try {
        await logAudit({
          userId,
          action: "AI_TOOL_PERMISSION_DENIED",
          entity: "AI_TOOL",
          entityId: toolCallId,
          metadata: { toolName, reason: perm.reason },
        });
      } catch {
        // Safe in unit test runs without active database
      }
      return {
        success: false,
        error: {
          code: "PERMISSION_DENIED",
          message: perm.reason || "Permissão negada para executar esta ferramenta.",
        },
      };
    }

    // 5. Schema Validation via tool.inputSchema (Zod)
    const validation = tool.inputSchema.safeParse(args);
    if (!validation.success) {
      return {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Parâmetros inválidos para a ferramenta.",
          details: validation.error.format(),
        },
      };
    }

    // 6. Approval Engine Check (REVIEW_FIRST vs AUTO_APPLY)
    const needsApproval = await ApprovalEngine.requiresApproval(tool, context, validation.data);
    if (needsApproval) {
      // Capture current version of target entity for optimistic concurrency and conflict detection
      let entityVersionAtProposal: number | undefined = undefined;
      let targetEntityId: string | undefined = undefined;
      let entityType: string = tool.category;

      if (tool.name === "healthvault_update_medication") {
        const medId = validation.data.medication_id;
        let med = await db.medication.findFirst({
          where: { id: medId, userId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        if (!med) {
          med = await db.medication.findFirst({
            where: { name: { equals: medId, mode: "insensitive" }, userId },
            include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          });
        }
        if (med) {
          targetEntityId = med.id;
          entityVersionAtProposal = med.versions[0]?.versionNumber || 1;
          entityType = "medication";
        }
      } else if (tool.name === "healthvault_update_diet") {
        const diet = await db.dietPlan.findFirst({
          where: { userId, isActive: true },
          orderBy: { updatedAt: "desc" },
        });
        if (diet) {
          targetEntityId = diet.id;
          entityVersionAtProposal = diet.currentVersion;
          entityType = "diet";
        }
      } else if (tool.name === "healthvault_update_recommendation") {
        const rec = await db.recommendation.findFirst({
          where: { id: validation.data.recommendation_id, userId },
        });
        if (rec) {
          targetEntityId = rec.id;
          entityVersionAtProposal = rec.currentVersion;
          entityType = "recommendation";
        }
      }

      const ttlMinutes = parseInt(process.env.AI_APPROVAL_TTL_MINUTES || "60", 10);
      const proposedAt = new Date();
      const expiresAt = new Date(proposedAt.getTime() + ttlMinutes * 60000);

      const enrichedInput = {
        ...validation.data,
        _proposalMeta: {
          entityId: targetEntityId,
          entityType,
          entityVersionAtProposal,
          proposedAt: proposedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      };

      const pendingExec = await db.aiToolExecution.create({
        data: {
          userId,
          conversationId,
          messageId,
          integrationId,
          toolCallId,
          toolName,
          status: "PENDING_APPROVAL",
          requiresApproval: true,
          inputJson: enrichedInput,
        },
      });

      await logAudit({
        userId,
        action: "AI_TOOL_PENDING_APPROVAL",
        entity: "AI_TOOL_EXECUTION",
        entityId: pendingExec.id,
        metadata: { toolName, input: validation.data, entityVersionAtProposal, expiresAt: expiresAt.toISOString() },
      });

      return {
        success: true,
        requires_approval: true,
        execution_id: pendingExec.id,
        message: `Esta ação requer confirmação manual no HealthVault antes de alterar seus registros clínicos.`,
        proposal: validation.data,
      };
    }

    // 7. Execute handler via domain services
    try {
      await logAudit({
        userId,
        action: "AI_TOOL_STARTED",
        entity: "AI_TOOL",
        entityId: toolCallId,
        metadata: { toolName },
      });

      const result = await tool.handler(context, validation.data);

      if (result.success) {
        // Record completed execution
        await db.aiToolExecution.create({
          data: {
            userId,
            conversationId,
            messageId,
            integrationId,
            toolCallId,
            toolName,
            status: "EXECUTED",
            requiresApproval: false,
            inputJson: validation.data,
            outputJson: result as any,
            completedAt: new Date(),
          },
        });

        await logAudit({
          userId,
          action: "AI_TOOL_SUCCEEDED",
          entity: "AI_TOOL",
          entityId: toolCallId,
          metadata: { toolName, data: result.data },
        });
      } else {
        await db.aiToolExecution.create({
          data: {
            userId,
            conversationId,
            messageId,
            integrationId,
            toolCallId,
            toolName,
            status: "FAILED",
            requiresApproval: false,
            inputJson: validation.data,
            errorCode: result.error?.code || "EXECUTION_ERROR",
            errorMessage: result.error?.message || "Handler returned failure",
            completedAt: new Date(),
          },
        });
      }

      return result;
    } catch (err: any) {
      console.error(`Tool execution error for ${toolName}:`, err);

      await db.aiToolExecution.create({
        data: {
          userId,
          conversationId,
          messageId,
          integrationId,
          toolCallId,
          toolName,
          status: "FAILED",
          requiresApproval: false,
          inputJson: validation.data,
          errorCode: "INTERNAL_ERROR",
          errorMessage: err?.message || "Erro inesperado ao executar ferramenta",
          completedAt: new Date(),
        },
      });

      await logAudit({
        userId,
        action: "AI_TOOL_FAILED",
        entity: "AI_TOOL",
        entityId: toolCallId,
        metadata: { toolName, error: err?.message },
      });

      return {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err?.message || "Erro interno ao executar a ferramenta.",
        },
      };
    }
  }
}
