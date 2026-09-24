import { db } from "../db";
import { MedicationService } from "./medication-service";
import { DietService } from "./diet-service";
import { RecommendationService } from "./recommendation-service";
import { logAudit } from "../audit";
import { ActorType } from "@prisma/client";

export interface RevertOptions {
  userId: string;
  entityType: "medication" | "diet" | "recommendation";
  entityId: string;
  targetVersionNumber?: number;
  reason?: string;
  conversationId?: string;
}

export class RevertService {
  /**
   * Reverts an entity to the state of a previous version by creating a NEW version.
   * Prior versions are NEVER deleted or overwritten.
   */
  static async revert(options: RevertOptions) {
    const { userId, entityType, entityId, targetVersionNumber, reason, conversationId } = options;

    if (entityType === "medication") {
      const med = await db.medication.findFirst({
        where: { id: entityId, userId },
        include: {
          versions: { orderBy: { versionNumber: "desc" } },
        },
      });

      if (!med || med.versions.length < 2) {
        throw new Error("Medicamento não possui versões anteriores suficientes para reversão.");
      }

      // Target is either requested version or immediately preceding version (index 1)
      const targetVer = targetVersionNumber
        ? med.versions.find((v) => v.versionNumber === targetVersionNumber)
        : med.versions[1];

      if (!targetVer) {
        throw new Error(`Versão v${targetVersionNumber} não encontrada no histórico do medicamento.`);
      }

      const reversalReason = reason || `Reversão para os parâmetros da versão v${targetVer.versionNumber}`;

      const updated = await MedicationService.updateDose(userId, {
        medicationId: med.id,
        doseValue: targetVer.doseValue,
        doseUnit: targetVer.doseUnit,
        frequency: targetVer.frequency,
        schedule: targetVer.schedule || undefined,
        route: targetVer.route || undefined,
        changeReason: reversalReason,
        conversationId,
        actorType: ActorType.USER,
        informationOrigin: "USER_REPORTED",
      });

      await logAudit({
        userId,
        action: "MEDICATION_REVERTED",
        entity: "MEDICATION",
        entityId: med.id,
        metadata: {
          fromVersion: med.versions[0].versionNumber,
          toNewVersion: updated.version.versionNumber,
          revertedFromTarget: targetVer.versionNumber,
        },
      });

      return {
        entityType: "medication",
        id: med.id,
        revertedToVersion: updated.version.versionNumber,
        restoredParameters: {
          dose: `${targetVer.doseValue} ${targetVer.doseUnit}`,
          frequency: targetVer.frequency,
        },
      };
    }

    if (entityType === "diet") {
      const diet = await db.dietPlan.findFirst({
        where: { id: entityId, userId },
        include: {
          versions: { orderBy: { versionNumber: "desc" } },
        },
      });

      if (!diet || diet.versions.length < 2) {
        throw new Error("Plano alimentar não possui versões anteriores para reversão.");
      }

      const targetVer = targetVersionNumber
        ? diet.versions.find((v) => v.versionNumber === targetVersionNumber)
        : diet.versions[1];

      if (!targetVer) {
        throw new Error(`Versão v${targetVersionNumber} da dieta não encontrada.`);
      }

      const reversalReason = reason || `Reversão para as metas da versão v${targetVer.versionNumber}`;

      const updated = await DietService.update(userId, {
        dietPlanId: diet.id,
        targetCalories: targetVer.targetCalories,
        targetProteinG: targetVer.targetProteinG,
        targetCarbsG: targetVer.targetCarbsG,
        targetFatG: targetVer.targetFatG,
        changeReason: reversalReason,
        conversationId,
        informationOrigin: "USER_REPORTED",
      });

      await logAudit({
        userId,
        action: "DIET_REVERTED",
        entity: "DIET_PLAN",
        entityId: diet.id,
        metadata: {
          fromVersion: diet.versions[0].versionNumber,
          toNewVersion: updated.version.versionNumber,
          revertedFromTarget: targetVer.versionNumber,
        },
      });

      return {
        entityType: "diet",
        id: diet.id,
        revertedToVersion: updated.version.versionNumber,
        restoredParameters: {
          calories: targetVer.targetCalories,
          proteinG: targetVer.targetProteinG,
        },
      };
    }

    if (entityType === "recommendation") {
      const rec = await db.recommendation.findFirst({
        where: { id: entityId, userId },
        include: {
          versions: { orderBy: { versionNumber: "desc" } },
        },
      });

      if (!rec || rec.versions.length < 2) {
        throw new Error("Recomendação não possui versões anteriores para reversão.");
      }

      const targetVer = targetVersionNumber
        ? rec.versions.find((v) => v.versionNumber === targetVersionNumber)
        : rec.versions[1];

      if (!targetVer) throw new Error("Versão alvo não encontrada.");

      const reversalReason = reason || `Reversão para o protocolo da versão v${targetVer.versionNumber}`;

      const updated = await RecommendationService.update(userId, {
        recommendationId: rec.id,
        summarySnapshot: targetVer.summarySnapshot as any,
        changeReason: reversalReason,
        conversationId,
        actorType: ActorType.USER,
        informationOrigin: "USER_REPORTED",
      });

      await logAudit({
        userId,
        action: "RECOMMENDATION_REVERTED",
        entity: "RECOMMENDATION",
        entityId: rec.id,
        metadata: {
          fromVersion: rec.versions[0].versionNumber,
          toNewVersion: updated.currentVersion,
          revertedFromTarget: targetVer.versionNumber,
        },
      });

      return {
        entityType: "recommendation",
        id: rec.id,
        revertedToVersion: updated.currentVersion,
      };
    }

    throw new Error(`Tipo de entidade '${entityType}' não suportado para reversão.`);
  }
}
