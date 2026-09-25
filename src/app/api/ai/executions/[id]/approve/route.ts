import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { MedicationService } from "@/lib/services/medication-service";
import { DietService } from "@/lib/services/diet-service";
import { RecommendationService } from "@/lib/services/recommendation-service";
import { HealthService } from "@/lib/services/health-service";
import { logAudit } from "@/lib/audit";
import { ActorType, SenderType } from "@prisma/client";

const approvalSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

async function syncMessageToolExecution(params: {
  conversationId: string;
  messageId?: string | null;
  executionId: string;
  toolCallId: string;
  action: "approve" | "reject" | "expired" | "conflict";
  outputResult?: any;
  errorCode?: string;
  errorMessage?: string;
}) {
  const {
    conversationId,
    messageId,
    executionId,
    toolCallId,
    action,
    outputResult,
    errorCode,
    errorMessage,
  } = params;

  let message = messageId
    ? await db.message.findUnique({ where: { id: messageId } })
    : null;

  if (!message) {
    const messages = await db.message.findMany({
      where: { conversationId, senderType: SenderType.AI },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    message =
      messages.find((m) => {
        const tools = (m.metadata as any)?.toolExecutions;
        return (
          Array.isArray(tools) &&
          tools.some(
            (t: any) =>
              t.output?.execution_id === executionId ||
              t.toolCallId === toolCallId
          )
        );
      }) || null;
  }

  if (!message) return;

  const currentMetadata = (message.metadata as Record<string, any>) || {};
  const toolExecutions = Array.isArray(currentMetadata.toolExecutions)
    ? currentMetadata.toolExecutions
    : [];

  let matched = false;
  const updatedToolExecutions = toolExecutions.map((te: any) => {
    const isTarget =
      te.output?.execution_id === executionId || te.toolCallId === toolCallId;

    if (!isTarget) return te;
    matched = true;

    if (action === "approve") {
      return {
        ...te,
        output: {
          ...te.output,
          requires_approval: false,
          resolvedAction: "approve",
          success: true,
          data: outputResult,
        },
      };
    } else if (action === "reject") {
      return {
        ...te,
        output: {
          ...te.output,
          requires_approval: false,
          resolvedAction: "reject",
        },
      };
    } else if (action === "expired") {
      return {
        ...te,
        output: {
          ...te.output,
          requires_approval: false,
          resolvedAction: "expired",
          errorCode: errorCode || "PROPOSAL_EXPIRED",
          errorMessage,
        },
      };
    } else if (action === "conflict") {
      return {
        ...te,
        output: {
          ...te.output,
          requires_approval: false,
          resolvedAction: "conflict",
          errorCode: errorCode || "VERSION_CONFLICT",
          errorMessage,
        },
      };
    }
    return te;
  });

  if (matched) {
    await db.message.update({
      where: { id: message.id },
      data: {
        metadata: {
          ...currentMetadata,
          toolExecutions: updatedToolExecutions,
        },
      },
    });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = approvalSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const execution = await db.aiToolExecution.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!execution) {
      return NextResponse.json({ error: "Execution record not found" }, { status: 404 });
    }

    if (execution.status !== "PENDING_APPROVAL") {
      return NextResponse.json(
        {
          error: `Execution is already in '${execution.status}' state.`,
          status: execution.status,
          code: "ALREADY_RESOLVED",
          result: execution.outputJson,
        },
        { status: 400 }
      );
    }

    const { action } = result.data;
    const args: any = execution.inputJson;
    const meta = args._proposalMeta;

    if (action === "reject") {
      const updated = await db.aiToolExecution.update({
        where: { id: execution.id },
        data: {
          status: "REJECTED",
          completedAt: new Date(),
        },
      });

      await syncMessageToolExecution({
        conversationId: execution.conversationId,
        messageId: execution.messageId,
        executionId: execution.id,
        toolCallId: execution.toolCallId,
        action: "reject",
      });

      await logAudit({
        userId: user!.userId,
        action: "AI_TOOL_REJECTED",
        entity: "AI_TOOL_EXECUTION",
        entityId: execution.id,
        metadata: { toolName: execution.toolName, input: args },
      });

      return NextResponse.json({ success: true, status: "REJECTED" });
    }

    // Check Proposal TTL / Expiration
    if (meta?.expiresAt) {
      const isExpired = new Date() > new Date(meta.expiresAt);
      if (isExpired) {
        await db.aiToolExecution.update({
          where: { id: execution.id },
          data: { status: "EXPIRED", completedAt: new Date() },
        });

        const expiredMsg =
          "Esta proposta de alteração expirou. Solicite ao assistente uma nova proposta atualizada.";

        await syncMessageToolExecution({
          conversationId: execution.conversationId,
          messageId: execution.messageId,
          executionId: execution.id,
          toolCallId: execution.toolCallId,
          action: "expired",
          errorCode: "PROPOSAL_EXPIRED",
          errorMessage: expiredMsg,
        });

        await logAudit({
          userId: user!.userId,
          action: "AI_TOOL_PROPOSAL_EXPIRED",
          entity: "AI_TOOL_EXECUTION",
          entityId: execution.id,
          metadata: { toolName: execution.toolName, expiredAt: meta.expiresAt },
        });

        return NextResponse.json(
          {
            error: expiredMsg,
            code: "PROPOSAL_EXPIRED",
          },
          { status: 410 }
        );
      }
    }

    // Check Optimistic Concurrency / Version Conflict
    if (meta?.entityVersionAtProposal !== undefined && meta?.entityId) {
      if (meta.entityType === "medication") {
        const currentMed = await db.medication.findUnique({
          where: { id: meta.entityId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        const currentVersion = currentMed?.versions[0]?.versionNumber;
        if (currentVersion !== undefined && currentVersion !== meta.entityVersionAtProposal) {
          const conflictMsg = `Conflito de versão: este medicamento foi alterado (v${meta.entityVersionAtProposal} → v${currentVersion}) após a criação da proposta. Gere uma nova proposta.`;
          await syncMessageToolExecution({
            conversationId: execution.conversationId,
            messageId: execution.messageId,
            executionId: execution.id,
            toolCallId: execution.toolCallId,
            action: "conflict",
            errorCode: "VERSION_CONFLICT",
            errorMessage: conflictMsg,
          });
          return NextResponse.json(
            {
              error: conflictMsg,
              code: "VERSION_CONFLICT",
            },
            { status: 409 }
          );
        }
      } else if (meta.entityType === "diet") {
        const currentDiet = await db.dietPlan.findUnique({
          where: { id: meta.entityId },
        });
        if (currentDiet && currentDiet.currentVersion !== meta.entityVersionAtProposal) {
          const conflictMsg = `Conflito de versão: o plano alimentar mudou (v${meta.entityVersionAtProposal} → v${currentDiet.currentVersion}) desde a geração desta sugestão.`;
          await syncMessageToolExecution({
            conversationId: execution.conversationId,
            messageId: execution.messageId,
            executionId: execution.id,
            toolCallId: execution.toolCallId,
            action: "conflict",
            errorCode: "VERSION_CONFLICT",
            errorMessage: conflictMsg,
          });
          return NextResponse.json(
            {
              error: conflictMsg,
              code: "VERSION_CONFLICT",
            },
            { status: 409 }
          );
        }
      } else if (meta.entityType === "recommendation") {
        const currentRec = await db.recommendation.findUnique({
          where: { id: meta.entityId },
        });
        if (currentRec && currentRec.currentVersion !== meta.entityVersionAtProposal) {
          const conflictMsg =
            "Conflito de versão: a recomendação clínica foi alterada por outra operação.";
          await syncMessageToolExecution({
            conversationId: execution.conversationId,
            messageId: execution.messageId,
            executionId: execution.id,
            toolCallId: execution.toolCallId,
            action: "conflict",
            errorCode: "VERSION_CONFLICT",
            errorMessage: conflictMsg,
          });
          return NextResponse.json(
            {
              error: conflictMsg,
              code: "VERSION_CONFLICT",
            },
            { status: 409 }
          );
        }
      }
    }

    // Action == approve -> Execute domain service safely!
    let outputResult: any = null;

    if (execution.toolName === "healthvault_create_medication") {
      const created = await MedicationService.create(user!.userId, {
        name: args.name,
        genericName: args.generic_name,
        category: args.category,
        form: args.form,
        doseValue: args.dose_value,
        doseUnit: args.dose_unit,
        frequency: args.frequency,
        schedule: args.schedule,
        changeReason: args.reason || "Aprovado manualmente pelo usuário",
        conversationId: execution.conversationId,
        actorType: ActorType.USER,
        actorName: user!.username,
        informationOrigin: "USER_REPORTED",
      });
      outputResult = { entity: "medication", id: created.id, name: created.name, version: 1 };
    } else if (execution.toolName === "healthvault_update_medication") {
      let med = await MedicationService.getById(user!.userId, args.medication_id);
      if (!med) med = await MedicationService.findByName(user!.userId, args.medication_id);
      if (!med) throw new Error("Medicamento associado não encontrado.");

      const updatedMed = await MedicationService.updateDose(user!.userId, {
        medicationId: med.id,
        doseValue: args.dose_value,
        doseUnit: args.dose_unit,
        frequency: args.frequency,
        schedule: args.schedule,
        changeReason: args.reason || "Ajuste aprovado pelo usuário",
        conversationId: execution.conversationId,
        actorType: ActorType.USER,
        actorName: user!.username,
        informationOrigin: "USER_REPORTED",
      });
      outputResult = { entity: "medication", id: med.id, name: med.name, version: updatedMed.version.versionNumber };
    } else if (execution.toolName === "healthvault_update_diet") {
      const updatedDiet = await DietService.update(user!.userId, {
        targetCalories: args.target_calories,
        targetProteinG: args.target_protein_g,
        targetCarbsG: args.target_carbs_g,
        targetFatG: args.target_fat_g,
        changeReason: args.reason || "Ajuste nutricional aprovado pelo usuário",
        conversationId: execution.conversationId,
        informationOrigin: "USER_REPORTED",
      });
      outputResult = { entity: "diet", version: updatedDiet.version.versionNumber, calories: args.target_calories };
    } else if (execution.toolName === "healthvault_add_lab_result") {
      const lab = await HealthService.addLabResult(user!.userId, {
        testName: args.test_name,
        markerName: args.marker_name,
        resultValue: args.result_value,
        unit: args.unit,
        referenceRangeLow: args.reference_range_low,
        referenceRangeHigh: args.reference_range_high,
        conversationId: execution.conversationId,
      });
      outputResult = { entity: "lab", id: lab.id, marker: lab.markerName };
    } else if (execution.toolName === "healthvault_update_recommendation") {
      const existing = await db.recommendation.findFirst({
        where: { id: args.recommendation_id, userId: user!.userId },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (existing) {
        const updated = await RecommendationService.update(user!.userId, {
          recommendationId: existing.id,
          title: args.title,
          notes: args.notes,
          summarySnapshot: (existing.versions[0]?.summarySnapshot as any) || {},
          changeReason: args.reason || "Aprovado pelo usuário",
          conversationId: execution.conversationId,
          actorType: ActorType.USER,
          informationOrigin: "USER_REPORTED",
        });
        outputResult = { entity: "recommendation", id: updated.id, version: updated.currentVersion };
      }
    }

    // Mark as EXECUTED
    await db.aiToolExecution.update({
      where: { id: execution.id },
      data: {
        status: "EXECUTED",
        approvedAt: new Date(),
        approvedBy: user!.username,
        completedAt: new Date(),
        outputJson: outputResult,
      },
    });

    await syncMessageToolExecution({
      conversationId: execution.conversationId,
      messageId: execution.messageId,
      executionId: execution.id,
      toolCallId: execution.toolCallId,
      action: "approve",
      outputResult,
    });

    await logAudit({
      userId: user!.userId,
      action: "AI_TOOL_APPROVED",
      entity: "AI_TOOL_EXECUTION",
      entityId: execution.id,
      metadata: { toolName: execution.toolName, result: outputResult },
    });

    return NextResponse.json({ success: true, status: "EXECUTED", result: outputResult });
  } catch (error: any) {
    console.error("Approve execution error:", error);
    return NextResponse.json({ error: error?.message || "Failed to approve tool execution" }, { status: 500 });
  }
}
