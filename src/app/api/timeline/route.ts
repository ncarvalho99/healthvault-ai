import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const userId = user!.userId;

  // 1. Medication versions (dosage changes)
  const medVersions = await db.medicationVersion.findMany({
    where: { medication: { userId } },
    include: { medication: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // 2. Diet versions (macro changes)
  const dietVersions = await db.dietVersion.findMany({
    where: { dietPlan: { userId } },
    include: { dietPlan: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // 3. Body metrics
  const metrics = await db.bodyMetric.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 50,
  });

  // 4. Symptoms
  const symptoms = await db.symptom.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 50,
  });

  // 5. Labs
  const labs = await db.labTest.findMany({
    where: { userId },
    orderBy: { testDate: "desc" },
    take: 50,
  });

  // Merge and normalize into timeline items
  const events: any[] = [];

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
      actorName: mv.actorName,
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

  return NextResponse.json({ events });
}

export async function DELETE(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const eventId = url.searchParams.get("eventId");
  const userId = user!.userId;

  try {
    if (action === "clearAll") {
      // Clear user timeline entries (metrics, symptoms, labs)
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

      return NextResponse.json({ success: true, message: "Linha do tempo limpa com sucesso" });
    }

    if (eventId) {
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

      return NextResponse.json({ success: true, message: "Evento removido da linha do tempo" });
    }

    return NextResponse.json({ error: "Missing action or eventId parameter" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete timeline event" }, { status: 500 });
  }
}
