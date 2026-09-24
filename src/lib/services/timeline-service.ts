import { db } from "../db";
import { logAudit } from "../audit";

export interface TimelineEventItem {
  id: string;
  rawId: string;
  rawType: string;
  type: "MEDICATION" | "DIET" | "METRIC" | "SYMPTOM" | "LAB";
  title: string;
  subtitle?: string;
  description?: string;
  date: Date;
  actorType?: string;
  actorName?: string;
  badgeColor: string;
}

export class TimelineService {
  /**
   * Retrieves unified chronological evolution of dosage changes, dietary adjustments, and measurements directly from the database without self-HTTP requests.
   */
  static async getTimeline(userId: string, limit = 50): Promise<TimelineEventItem[]> {
    // 1. Medication versions (dosage changes)
    const medVersions = await db.medicationVersion.findMany({
      where: { medication: { userId } },
      include: { medication: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // 2. Diet versions (macro changes)
    const dietVersions = await db.dietVersion.findMany({
      where: { dietPlan: { userId } },
      include: { dietPlan: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // 3. Body metrics
    const metrics = await db.bodyMetric.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: limit,
    });

    // 4. Symptoms
    const symptoms = await db.symptom.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: limit,
    });

    // 5. Labs
    const labs = await db.labTest.findMany({
      where: { userId },
      orderBy: { testDate: "desc" },
      take: limit,
    });

    const events: TimelineEventItem[] = [];

    for (const mv of medVersions) {
      events.push({
        id: `med-${mv.id}`,
        rawId: mv.id,
        rawType: "MEDICATION_VERSION",
        type: "MEDICATION",
        title: `${mv.medication.name} (v${mv.versionNumber})`,
        subtitle: `${mv.doseValue} ${mv.doseUnit} • ${mv.frequency}`,
        description: mv.changeReason || "Dosage adjustment",
        date: mv.startDate || mv.createdAt,
        actorType: mv.actorType,
        actorName: mv.actorName || undefined,
        badgeColor: "emerald",
      });
    }

    for (const dv of dietVersions) {
      events.push({
        id: `diet-${dv.id}`,
        rawId: dv.id,
        rawType: "DIET_VERSION",
        type: "DIET",
        title: `${dv.dietPlan.title} (v${dv.versionNumber})`,
        subtitle: `${dv.targetCalories} kcal • P: ${dv.targetProteinG}g | C: ${dv.targetCarbsG}g | F: ${dv.targetFatG}g`,
        description: dv.changeReason || "Nutritional target update",
        date: dv.createdAt,
        badgeColor: "amber",
      });
    }

    for (const bm of metrics) {
      events.push({
        id: `metric-${bm.id}`,
        rawId: bm.id,
        rawType: "BODY_METRIC",
        type: "METRIC",
        title: `Peso Corporal: ${bm.weightKg} kg`,
        subtitle: bm.bodyFatPct ? `Gordura Corporal: ${bm.bodyFatPct}%` : undefined,
        description: bm.notes || "Registro de medidas corporais",
        date: bm.date,
        badgeColor: "blue",
      });
    }

    for (const s of symptoms) {
      events.push({
        id: `symptom-${s.id}`,
        rawId: s.id,
        rawType: "SYMPTOM",
        type: "SYMPTOM",
        title: `Sintoma: ${s.symptom} (Gravidade ${s.severity}/10)`,
        subtitle: s.possibleTrigger ? `Gatilho: ${s.possibleTrigger}` : undefined,
        description: s.description || undefined,
        date: s.date,
        badgeColor: s.severity >= 7 ? "rose" : "orange",
      });
    }

    for (const l of labs) {
      events.push({
        id: `lab-${l.id}`,
        rawId: l.id,
        rawType: "LAB_TEST",
        type: "LAB",
        title: `Exame: ${l.markerName} = ${l.resultValue} ${l.unit}`,
        subtitle: `${l.testName} • Status: ${l.flag}`,
        description: l.notes || `Faixa: ${l.referenceRangeLow ?? "-"} a ${l.referenceRangeHigh ?? "-"} ${l.unit}`,
        date: l.testDate,
        badgeColor: l.flag === "HIGH" || l.flag === "LOW" ? "rose" : "cyan",
      });
    }

    // Sort unified events descending by date
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return events.slice(0, limit);
  }

  static async clearAll(userId: string) {
    await db.$transaction([
      db.bodyMetric.deleteMany({ where: { userId } }),
      db.symptom.deleteMany({ where: { userId } }),
      db.labTest.deleteMany({ where: { userId } }),
    ]);

    await logAudit({
      userId,
      action: "TIMELINE_CLEARED",
      entity: "TIMELINE",
      metadata: { action: "clearAllMetricsSymptomsLabs" },
    });
  }

  static async deleteEvent(userId: string, eventId: string) {
    if (eventId.startsWith("metric-")) {
      const id = eventId.replace("metric-", "");
      await db.bodyMetric.deleteMany({ where: { id, userId } });
    } else if (eventId.startsWith("symptom-")) {
      const id = eventId.replace("symptom-", "");
      await db.symptom.deleteMany({ where: { id, userId } });
    } else if (eventId.startsWith("lab-")) {
      const id = eventId.replace("lab-", "");
      await db.labTest.deleteMany({ where: { id, userId } });
    } else if (eventId.startsWith("med-")) {
      const id = eventId.replace("med-", "");
      await db.medicationVersion.deleteMany({ where: { id, medication: { userId } } });
    } else if (eventId.startsWith("diet-")) {
      const id = eventId.replace("diet-", "");
      await db.dietVersion.deleteMany({ where: { id, dietPlan: { userId } } });
    }

    await logAudit({
      userId,
      action: "TIMELINE_EVENT_DELETED",
      entity: "TIMELINE",
      entityId: eventId,
    });
  }
}
