import { db } from "../db";
import { logAudit } from "../audit";
import { LabFlag } from "@prisma/client";

export class HealthService {
  static async addBodyMetric(
    userId: string,
    data: {
      weightKg: number;
      bodyFatPct?: number;
      muscleMassKg?: number;
      waistCm?: number;
      notes?: string;
      conversationId?: string;
    }
  ) {
    const metric = await db.bodyMetric.create({
      data: {
        userId,
        weightKg: data.weightKg,
        bodyFatPct: data.bodyFatPct,
        muscleMassKg: data.muscleMassKg,
        waistCm: data.waistCm,
        notes: data.notes,
        conversationId: data.conversationId,
        date: new Date(),
      },
    });

    await logAudit({
      userId,
      action: "BODY_METRIC_CREATED",
      entity: "BODY_METRIC",
      entityId: metric.id,
      metadata: { weightKg: data.weightKg, bodyFatPct: data.bodyFatPct },
    });

    return metric;
  }

  static async addSymptom(
    userId: string,
    data: {
      symptom: string;
      severity: number;
      description?: string;
      possibleTrigger?: string;
      medicationId?: string;
      conversationId?: string;
    }
  ) {
    const symptom = await db.symptom.create({
      data: {
        userId,
        symptom: data.symptom,
        severity: data.severity,
        description: data.description,
        possibleTrigger: data.possibleTrigger,
        medicationId: data.medicationId,
        conversationId: data.conversationId,
        date: new Date(),
      },
    });

    await logAudit({
      userId,
      action: "SYMPTOM_CREATED",
      entity: "SYMPTOM",
      entityId: symptom.id,
      metadata: { symptom: data.symptom, severity: data.severity },
    });

    return symptom;
  }

  static async addLabResult(
    userId: string,
    data: {
      testName: string;
      category?: string;
      markerName: string;
      resultValue: number;
      unit: string;
      referenceRangeLow?: number;
      referenceRangeHigh?: number;
      flag?: LabFlag;
      notes?: string;
      conversationId?: string;
    }
  ) {
    const lab = await db.labTest.create({
      data: {
        userId,
        testName: data.testName,
        category: data.category || "Geral",
        markerName: data.markerName,
        resultValue: data.resultValue,
        unit: data.unit,
        referenceRangeLow: data.referenceRangeLow,
        referenceRangeHigh: data.referenceRangeHigh,
        flag: data.flag || LabFlag.NORMAL,
        notes: data.notes,
        conversationId: data.conversationId,
        testDate: new Date(),
      },
    });

    await logAudit({
      userId,
      action: "LAB_TEST_CREATED",
      entity: "LAB_TEST",
      entityId: lab.id,
      metadata: { markerName: data.markerName, value: `${data.resultValue} ${data.unit}` },
    });

    return lab;
  }

  static async createReminder(
    userId: string,
    data: {
      title: string;
      dueDate: Date | string;
      notes?: string;
    }
  ) {
    const reminder = await db.reminder.create({
      data: {
        userId,
        title: data.title,
        dueDate: new Date(data.dueDate),
        notes: data.notes,
      },
    });

    await logAudit({
      userId,
      action: "REMINDER_CREATED",
      entity: "REMINDER",
      entityId: reminder.id,
      metadata: { title: data.title },
    });

    return reminder;
  }

  static async getSummaryContext(userId: string, includeParts: string[] = ["medications", "diet", "recommendations", "metrics"]) {
    const result: Record<string, any> = {};

    if (includeParts.includes("medications")) {
      const meds = await db.medication.findMany({
        where: { userId, isActive: true },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      result.activeMedications = meds.map((m) => {
        const v = m.versions[0];
        return {
          id: m.id,
          name: m.name,
          form: m.form,
          currentDose: v ? `${v.doseValue} ${v.doseUnit}` : "Desconhecida",
          frequency: v?.frequency,
          schedule: v?.schedule,
          version: v?.versionNumber,
        };
      });
    }

    if (includeParts.includes("diet")) {
      const diet = await db.dietPlan.findFirst({
        where: { userId, isActive: true },
        orderBy: { updatedAt: "desc" },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      const v = diet?.versions[0];
      result.currentDiet = v
        ? {
            planTitle: diet?.title,
            version: v.versionNumber,
            targetCalories: v.targetCalories,
            proteinG: v.targetProteinG,
            carbsG: v.targetCarbsG,
            fatG: v.targetFatG,
          }
        : null;
    }

    if (includeParts.includes("recommendations")) {
      const rec = await db.recommendation.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      result.latestRecommendation = rec
        ? {
            id: rec.id,
            title: rec.title,
            status: rec.status,
            version: rec.currentVersion,
            notes: rec.notes,
            summarySnapshot: rec.versions[0]?.summarySnapshot,
          }
        : null;
    }

    if (includeParts.includes("metrics")) {
      const metrics = await db.bodyMetric.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 3,
      });
      result.recentMetrics = metrics.map((m) => ({
        date: m.date.toISOString().split("T")[0],
        weightKg: m.weightKg,
        bodyFatPct: m.bodyFatPct,
      }));
    }

    if (includeParts.includes("symptoms")) {
      const symptoms = await db.symptom.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 5,
      });
      result.recentSymptoms = symptoms.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        symptom: s.symptom,
        severity: `${s.severity}/10`,
        trigger: s.possibleTrigger,
      }));
    }

    if (includeParts.includes("labs")) {
      const labs = await db.labTest.findMany({
        where: { userId },
        orderBy: { testDate: "desc" },
        take: 5,
      });
      result.recentLabs = labs.map((l) => ({
        date: l.testDate.toISOString().split("T")[0],
        marker: l.markerName,
        result: `${l.resultValue} ${l.unit}`,
        flag: l.flag,
      }));
    }

    return result;
  }
}
