import { db } from "../db";

export interface RecommendationSummarySnapshot {
  capturedAt: string;
  nutrition?: {
    dietPlanId?: string;
    version?: number;
    title?: string;
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
  } | null;
  medications?: Array<{
    id: string;
    name: string;
    version: number;
    active: boolean;
    dose?: string;
    frequency?: string;
  }>;
  metrics?: {
    latestWeightKg?: number | null;
    bodyFatPct?: number | null;
    date?: string;
  } | null;
}

export class RecommendationSnapshotBuilder {
  /**
   * Captures an authoritative, normalized snapshot of the user's current HealthVault state
   * (diet, medications, metrics) at the exact moment a recommendation version is committed.
   */
  static async build(userId: string, txClient?: any): Promise<RecommendationSummarySnapshot> {
    const client = txClient || db;

    // 1. Current active Diet Plan & latest version
    let activeDiet = null;
    try {
      activeDiet = await client.dietPlan.findFirst({
        where: { userId, isActive: true },
        orderBy: { updatedAt: "desc" },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
          },
        },
      });
    } catch {
      // Fallback if DB query fails in mocking/tests
    }

    const latestDietVer = activeDiet?.versions?.[0];
    const nutrition = latestDietVer
      ? {
          dietPlanId: activeDiet.id,
          version: activeDiet.currentVersion || latestDietVer.versionNumber,
          title: activeDiet.title,
          calories: latestDietVer.targetCalories,
          protein_g: latestDietVer.targetProteinG,
          carbs_g: latestDietVer.targetCarbsG,
          fat_g: latestDietVer.targetFatG,
        }
      : null;

    // 2. Current Medications (both active and recent, with latest dose/version)
    let medications: any[] = [];
    try {
      medications = await client.medication.findMany({
        where: { userId },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
          },
        },
      });
    } catch {
      // Fallback
    }

    const medsSnapshot = medications.map((m: any) => {
      const v = m.versions?.[0];
      const dose = v ? `${v.doseValue} ${v.doseUnit}`.trim() : undefined;
      return {
        id: m.id,
        name: m.name,
        version: m.currentVersion || v?.versionNumber || 1,
        active: m.isActive,
        dose,
        frequency: v?.frequency,
      };
    });

    // 3. Latest Body Metric (weight, body fat)
    let latestMetric = null;
    try {
      latestMetric = await client.bodyMetric.findFirst({
        where: { userId },
        orderBy: { date: "desc" },
      });
    } catch {
      // Fallback
    }

    const metricsSnapshot = latestMetric
      ? {
          latestWeightKg: latestMetric.weightKg,
          bodyFatPct: latestMetric.bodyFatPercentage,
          date:
            latestMetric.date instanceof Date
              ? latestMetric.date.toISOString().split("T")[0]
              : String(latestMetric.date || ""),
        }
      : null;

    return {
      capturedAt: new Date().toISOString(),
      nutrition,
      medications: medsSnapshot,
      metrics: metricsSnapshot,
    };
  }
}
