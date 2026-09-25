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

async function syncMessageToolExecution(
  client: any,
  params: {
    conversationId: string;
    messageId?: string | null;
    executionId: string;
    toolCallId: string;
    action: "approve" | "reject" | "expired" | "conflict";
    outputResult?: any;
    errorCode?: string;
    errorMessage?: string;
  }
) {
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
    ? await client.message.findUnique({ where: { id: messageId } })
    : null;

  if (!message) {
    const messages = await client.message.findMany({
      where: { conversationId, senderType: SenderType.AI },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    message =
      messages.find((m: any) => {
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

  if (!message) {
    throw new Error(
      `Mensagem associada à execução ${executionId} (toolCallId: ${toolCallId}) não foi encontrada na conversa ${conversationId}.`
    );
  }

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

  if (!matched) {
    throw new Error(
      `Tool execution ${executionId} (toolCallId: ${toolCallId}) não foi encontrada no metadata da mensagem ${message.id}.`
    );
  }

  await client.message.update({
    where: { id: message.id },
    data: {
      metadata: {
        ...currentMetadata,
        toolExecutions: updatedToolExecutions,
      },
    },
  });
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
      const rejectResult = await db.$transaction(async (tx) => {
        // Compare-and-set claim for reject
        const claim = await tx.aiToolExecution.updateMany({
          where: {
            id: execution.id,
            userId: user!.userId,
            status: "PENDING_APPROVAL",
          },
          data: {
            status: "REJECTED",
            completedAt: new Date(),
          },
        });

        if (claim.count !== 1) {
          return { type: "ALREADY_RESOLVED" as const };
        }

        await syncMessageToolExecution(tx, {
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
        }, tx);

        return { type: "REJECTED" as const };
      });

      if (rejectResult.type === "ALREADY_RESOLVED") {
        return NextResponse.json(
          {
            error: "Esta execução já foi processada ou está sendo executada concorrentemente.",
            code: "ALREADY_RESOLVED",
          },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true, status: "REJECTED" });
    }

    // Action == approve: Encompass atomic CAS claim, TTL check, version check, domain mutation, AiToolExecution, and Message metadata in ONE transaction!
    const txResult = await db.$transaction(async (tx) => {
      // 0. Compare-and-set atomic claim: PENDING_APPROVAL -> EXECUTING
      const claim = await tx.aiToolExecution.updateMany({
        where: {
          id: execution.id,
          userId: user!.userId,
          status: "PENDING_APPROVAL",
        },
        data: {
          status: "EXECUTING",
        },
      });

      if (claim.count !== 1) {
        return {
          type: "ALREADY_RESOLVED" as const,
        };
      }

      // 1. Re-check Proposal TTL / Expiration inside transaction
      if (meta?.expiresAt) {
        const isExpired = new Date() > new Date(meta.expiresAt);
        if (isExpired) {
          const expiredMsg =
            "Esta proposta de alteração expirou. Solicite ao assistente uma nova proposta atualizada.";

          await tx.aiToolExecution.update({
            where: { id: execution.id },
            data: {
              status: "FAILED",
              errorCode: "PROPOSAL_EXPIRED",
              errorMessage: expiredMsg,
              completedAt: new Date(),
            },
          });

          await syncMessageToolExecution(tx, {
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
          }, tx);

          return {
            type: "EXPIRED" as const,
            error: expiredMsg,
            code: "PROPOSAL_EXPIRED",
          };
        }
      }

      // 2. Re-check Optimistic Concurrency / Version Conflict inside transaction using tx
      if (meta?.entityVersionAtProposal !== undefined && meta?.entityId) {
        if (meta.entityType === "medication") {
          const currentMed = await tx.medication.findUnique({
            where: { id: meta.entityId },
            include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          });
          const currentVersion = currentMed?.versions[0]?.versionNumber;
          if (currentVersion !== undefined && currentVersion !== meta.entityVersionAtProposal) {
            const conflictMsg = `Conflito de versão: este medicamento foi alterado (v${meta.entityVersionAtProposal} → v${currentVersion}) após a criação da proposta. Gere uma nova proposta.`;

            await tx.aiToolExecution.update({
              where: { id: execution.id },
              data: {
                status: "FAILED",
                errorCode: "VERSION_CONFLICT",
                errorMessage: conflictMsg,
                completedAt: new Date(),
              },
            });

            await syncMessageToolExecution(tx, {
              conversationId: execution.conversationId,
              messageId: execution.messageId,
              executionId: execution.id,
              toolCallId: execution.toolCallId,
              action: "conflict",
              errorCode: "VERSION_CONFLICT",
              errorMessage: conflictMsg,
            });

            await logAudit({
              userId: user!.userId,
              action: "AI_TOOL_VERSION_CONFLICT",
              entity: "AI_TOOL_EXECUTION",
              entityId: execution.id,
              metadata: { toolName: execution.toolName, currentVersion, proposalVersion: meta.entityVersionAtProposal },
            }, tx);

            return {
              type: "CONFLICT" as const,
              error: conflictMsg,
              code: "VERSION_CONFLICT",
            };
          }
        } else if (meta.entityType === "diet") {
          const currentDiet = await tx.dietPlan.findUnique({
            where: { id: meta.entityId },
          });
          if (currentDiet && currentDiet.currentVersion !== meta.entityVersionAtProposal) {
            const conflictMsg = `Conflito de versão: o plano alimentar mudou (v${meta.entityVersionAtProposal} → v${currentDiet.currentVersion}) desde a geração desta sugestão.`;

            await tx.aiToolExecution.update({
              where: { id: execution.id },
              data: {
                status: "FAILED",
                errorCode: "VERSION_CONFLICT",
                errorMessage: conflictMsg,
                completedAt: new Date(),
              },
            });

            await syncMessageToolExecution(tx, {
              conversationId: execution.conversationId,
              messageId: execution.messageId,
              executionId: execution.id,
              toolCallId: execution.toolCallId,
              action: "conflict",
              errorCode: "VERSION_CONFLICT",
              errorMessage: conflictMsg,
            });

            await logAudit({
              userId: user!.userId,
              action: "AI_TOOL_VERSION_CONFLICT",
              entity: "AI_TOOL_EXECUTION",
              entityId: execution.id,
              metadata: { toolName: execution.toolName, currentVersion: currentDiet.currentVersion, proposalVersion: meta.entityVersionAtProposal },
            }, tx);

            return {
              type: "CONFLICT" as const,
              error: conflictMsg,
              code: "VERSION_CONFLICT",
            };
          }
        } else if (meta.entityType === "recommendation") {
          const currentRec = await tx.recommendation.findUnique({
            where: { id: meta.entityId },
          });
          if (currentRec && currentRec.currentVersion !== meta.entityVersionAtProposal) {
            const conflictMsg =
              "Conflito de versão: a recomendação clínica foi alterada por outra operação.";

            await tx.aiToolExecution.update({
              where: { id: execution.id },
              data: {
                status: "FAILED",
                errorCode: "VERSION_CONFLICT",
                errorMessage: conflictMsg,
                completedAt: new Date(),
              },
            });

            await syncMessageToolExecution(tx, {
              conversationId: execution.conversationId,
              messageId: execution.messageId,
              executionId: execution.id,
              toolCallId: execution.toolCallId,
              action: "conflict",
              errorCode: "VERSION_CONFLICT",
              errorMessage: conflictMsg,
            });

            await logAudit({
              userId: user!.userId,
              action: "AI_TOOL_VERSION_CONFLICT",
              entity: "AI_TOOL_EXECUTION",
              entityId: execution.id,
              metadata: { toolName: execution.toolName, currentVersion: currentRec.currentVersion, proposalVersion: meta.entityVersionAtProposal },
            }, tx);

            return {
              type: "CONFLICT" as const,
              error: conflictMsg,
              code: "VERSION_CONFLICT",
            };
          }
        }
      }

      // 3. Execute domain mutation using tx!
      let outputResult: any = null;

      if (execution.toolName === "healthvault_create_medication") {
        const created = await MedicationService.create(user!.userId, {
          name: args.name,
          genericName: args.generic_name,
          brandName: args.brand_name,
          category: args.category,
          form: args.form,
          doseValue: args.dose_value,
          doseUnit: args.dose_unit,
          frequency: args.frequency,
          schedule: args.schedule,
          route: args.route,
          instructions: args.instructions,
          changeReason: args.reason || "Aprovado manualmente pelo usuário",
          conversationId: execution.conversationId,
          actorType: ActorType.USER,
          actorName: user!.username,
          informationOrigin: "USER_REPORTED",
        }, tx);
        outputResult = { entity: "medication", id: created.id, name: created.name, version: 1 };
      } else if (execution.toolName === "healthvault_update_medication") {
        const targetMedId = meta?.entityId || args.medication_id;
        let med = await MedicationService.getById(user!.userId, targetMedId, tx);
        if (!med && !meta?.entityId) med = await MedicationService.findByName(user!.userId, args.medication_id, tx);
        if (!med) throw new Error("Medicamento associado não encontrado.");

        const updatedMed = await MedicationService.updateDose(user!.userId, {
          medicationId: med.id,
          doseValue: args.dose_value,
          doseUnit: args.dose_unit,
          frequency: args.frequency,
          schedule: args.schedule,
          route: args.route,
          instructions: args.instructions,
          changeReason: args.reason || "Ajuste aprovado pelo usuário",
          conversationId: execution.conversationId,
          actorType: ActorType.USER,
          actorName: user!.username,
          informationOrigin: "USER_REPORTED",
        }, tx);
        outputResult = { entity: "medication", id: med.id, name: med.name, version: updatedMed.version.versionNumber };
      } else if (execution.toolName === "healthvault_stop_medication") {
        const targetMedId = meta?.entityId || args.medication_id;
        let med = await MedicationService.getById(user!.userId, targetMedId, tx);
        if (!med && !meta?.entityId) med = await MedicationService.findByName(user!.userId, args.medication_id, tx);
        if (!med) throw new Error("Medicamento associado não encontrado.");

        const stoppedMed = await MedicationService.stopMedication(
          user!.userId,
          med.id,
          args.reason || "Medicamento descontinuado pelo usuário",
          execution.conversationId,
          tx
        );
        outputResult = { entity: "medication", id: med.id, name: med.name, status: "DISCONTINUED", version: stoppedMed.currentVersion };
      } else if (execution.toolName === "healthvault_create_recommendation") {
        const created = await RecommendationService.create(user!.userId, {
          title: args.title,
          notes: args.notes,
          status: args.status,
          sourceType: "AI_AGENT",
          sourceName: user!.username,
          conversationId: execution.conversationId,
          changeReason: args.reason || "Recomendação aprovada pelo usuário",
        }, tx);
        outputResult = { entity: "recommendation", id: created.id, title: created.title, version: 1 };
      } else if (execution.toolName === "healthvault_update_recommendation") {
        const targetRecId = meta?.entityId || args.recommendation_id;
        const existing = await tx.recommendation.findFirst({
          where: { id: targetRecId, userId: user!.userId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        });
        if (!existing) throw new Error("Recomendação associada não encontrada.");

        const updated = await RecommendationService.update(user!.userId, {
          recommendationId: existing.id,
          title: args.title,
          notes: args.notes,
          status: args.status,
          summarySnapshot: (existing.versions[0]?.summarySnapshot as any) || {},
          changeReason: args.reason || "Aprovado pelo usuário",
          conversationId: execution.conversationId,
          actorType: ActorType.USER,
          informationOrigin: "USER_REPORTED",
        }, tx);
        outputResult = { entity: "recommendation", id: updated.id, version: updated.currentVersion };
      } else if (execution.toolName === "healthvault_create_diet") {
        const createdDiet = await DietService.create(user!.userId, {
          title: args.title,
          goal: args.goal,
          targetCalories: args.target_calories,
          targetProteinG: args.target_protein_g,
          targetCarbsG: args.target_carbs_g,
          targetFatG: args.target_fat_g,
          changeReason: args.reason || "Plano nutricional aprovado pelo usuário",
          conversationId: execution.conversationId,
          informationOrigin: "USER_REPORTED",
        }, tx);
        outputResult = { entity: "diet", id: createdDiet.id, version: 1 };
      } else if (execution.toolName === "healthvault_update_diet") {
        const targetDietId = meta?.entityId || args.diet_plan_id;
        const updatedDiet = await DietService.update(user!.userId, {
          dietPlanId: targetDietId,
          targetCalories: args.target_calories,
          targetProteinG: args.target_protein_g,
          targetCarbsG: args.target_carbs_g,
          targetFatG: args.target_fat_g,
          changeReason: args.reason || "Ajuste nutricional aprovado pelo usuário",
          conversationId: execution.conversationId,
          informationOrigin: "USER_REPORTED",
        }, tx);
        outputResult = { entity: "diet", id: updatedDiet.plan.id, version: updatedDiet.version.versionNumber };
      } else if (execution.toolName === "healthvault_add_body_metric") {
        const metric = await HealthService.addBodyMetric(user!.userId, {
          weightKg: args.weight_kg,
          bodyFatPct: args.body_fat_pct,
          waistCm: args.waist_cm,
          muscleMassKg: args.muscle_mass_kg,
          notes: args.notes,
          conversationId: execution.conversationId,
        }, tx);
        outputResult = { entity: "metric", id: metric.id, weightKg: metric.weightKg };
      } else if (execution.toolName === "healthvault_add_symptom") {
        const symptom = await HealthService.addSymptom(user!.userId, {
          symptom: args.symptom,
          severity: args.severity,
          description: args.description,
          possibleTrigger: args.possible_trigger,
          medicationId: args.medication_id,
          conversationId: execution.conversationId,
        }, tx);
        outputResult = { entity: "symptom", id: symptom.id, symptom: symptom.symptom, severity: symptom.severity };
      } else if (execution.toolName === "healthvault_add_lab_result") {
        const lab = await HealthService.addLabResult(user!.userId, {
          testName: args.test_name,
          category: args.category,
          markerName: args.marker_name,
          resultValue: args.result_value,
          unit: args.unit,
          referenceRangeLow: args.reference_range_low,
          referenceRangeHigh: args.reference_range_high,
          notes: args.notes,
          conversationId: execution.conversationId,
        }, tx);
        outputResult = { entity: "lab", id: lab.id, markerName: lab.markerName, value: `${lab.resultValue} ${lab.unit}` };
      } else {
        throw new Error(`UNSUPPORTED_APPROVAL_TOOL: Tool '${execution.toolName}' is not supported for approval.`);
      }

      if (!outputResult) {
        throw new Error(`UNSUPPORTED_APPROVAL_TOOL: Tool '${execution.toolName}' produced no output result.`);
      }

      // 4. Mark as EXECUTED in tx
      await tx.aiToolExecution.update({
        where: { id: execution.id },
        data: {
          status: "EXECUTED",
          approvedAt: new Date(),
          approvedBy: user!.username,
          completedAt: new Date(),
          outputJson: outputResult,
        },
      });

      // 5. Update Message.metadata in tx (throws if message or tool execution not matched!)
      await syncMessageToolExecution(tx, {
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
      }, tx);

      return {
        type: "SUCCESS" as const,
        outputResult,
      };
    });

    if (txResult.type === "ALREADY_RESOLVED") {
      return NextResponse.json(
        {
          error: "Esta execução já foi processada ou está sendo executada concorrentemente.",
          code: "ALREADY_RESOLVED",
        },
        { status: 400 }
      );
    }

    if (txResult.type === "EXPIRED") {
      return NextResponse.json({ error: txResult.error, code: txResult.code }, { status: 410 });
    }

    if (txResult.type === "CONFLICT") {
      return NextResponse.json({ error: txResult.error, code: txResult.code }, { status: 409 });
    }

    return NextResponse.json({ success: true, status: "EXECUTED", result: txResult.outputResult });
  } catch (error: any) {
    console.error("Approve execution error:", error);
    return NextResponse.json({ error: error?.message || "Failed to approve tool execution" }, { status: 500 });
  }
}
