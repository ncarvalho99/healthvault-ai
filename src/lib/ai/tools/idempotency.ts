import { db } from "../../db";
import { ToolExecutionContext, ToolExecutionResult } from "./types";
import { logAudit } from "../../audit";

export class IdempotencyEngine {
  /**
   * Checks if this tool call was already completed.
   */
  static async getExistingResult(context: ToolExecutionContext): Promise<ToolExecutionResult | null> {
    const existing = await db.aiToolExecution.findFirst({
      where: {
        toolCallId: context.toolCallId,
        conversationId: context.conversationId,
      },
    });

    if (!existing) return null;

    if (existing.status === "EXECUTED" && existing.outputJson) {
      await logAudit({
        userId: context.userId,
        action: "AI_TOOL_DUPLICATE_IGNORED",
        entity: "AI_TOOL_EXECUTION",
        entityId: existing.id,
        metadata: { toolCallId: context.toolCallId, toolName: context.toolName },
      });

      return existing.outputJson as unknown as ToolExecutionResult;
    }

    if (existing.status === "PENDING_APPROVAL") {
      return {
        success: true,
        requires_approval: true,
        execution_id: existing.id,
        message: "Esta ação já está aguardando sua aprovação no chat.",
        proposal: existing.inputJson,
      };
    }

    return null;
  }
}
