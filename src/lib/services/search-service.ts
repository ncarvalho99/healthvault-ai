import { db } from "../db";

export interface SearchOptions {
  userId: string;
  query: string;
  entityTypes?: string[];
  limit?: number;
}

export interface SearchResultItem {
  entityType: string;
  entityId: string;
  title: string;
  summary: string;
  date?: string | Date;
  version?: number;
}

export class SearchService {
  static async search(options: SearchOptions): Promise<SearchResultItem[]> {
    const { userId, query, entityTypes = [], limit = 10 } = options;
    const q = query.trim().toLowerCase();
    const results: SearchResultItem[] = [];

    const searchAll = entityTypes.length === 0;

    // 1. Search Medications & Versions
    if (searchAll || entityTypes.includes("medications")) {
      const meds = await db.medication.findMany({
        where: {
          userId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { genericName: { contains: q, mode: "insensitive" } },
            { brandName: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        take: limit,
      });

      for (const m of meds) {
        const v = m.versions[0];
        results.push({
          entityType: "medication",
          entityId: m.id,
          title: m.name,
          summary: v ? `Dose: ${v.doseValue} ${v.doseUnit} • ${v.frequency} (${m.isActive ? "Ativo" : "Descontinuado"})` : m.category || "Medicamento",
          date: v?.startDate || m.updatedAt,
          version: v?.versionNumber || 1,
        });
      }
    }

    // 2. Search Recommendations & Versions
    if (searchAll || entityTypes.includes("recommendations")) {
      const recs = await db.recommendation.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        },
        take: limit,
      });

      for (const r of recs) {
        results.push({
          entityType: "recommendation",
          entityId: r.id,
          title: r.title,
          summary: r.notes || `Protocolo ${r.status}`,
          date: r.updatedAt,
          version: r.currentVersion,
        });
      }
    }

    // 3. Search Diets
    if (searchAll || entityTypes.includes("diets")) {
      const diets = await db.dietPlan.findMany({
        where: {
          userId,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { goal: { contains: q, mode: "insensitive" } },
          ],
        },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        take: limit,
      });

      for (const d of diets) {
        const v = d.versions[0];
        results.push({
          entityType: "diet",
          entityId: d.id,
          title: d.title,
          summary: v ? `${v.targetCalories} kcal (P: ${v.targetProteinG}g, C: ${v.targetCarbsG}g, G: ${v.targetFatG}g)` : d.goal || "Dieta",
          date: v?.createdAt || d.updatedAt,
          version: d.currentVersion,
        });
      }
    }

    // 4. Search Symptoms
    if (searchAll || entityTypes.includes("symptoms")) {
      const symptoms = await db.symptom.findMany({
        where: {
          userId,
          OR: [
            { symptom: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { possibleTrigger: { contains: q, mode: "insensitive" } },
          ],
        },
        take: limit,
      });

      for (const s of symptoms) {
        results.push({
          entityType: "symptom",
          entityId: s.id,
          title: `Sintoma: ${s.symptom}`,
          summary: `Gravidade ${s.severity}/10${s.possibleTrigger ? ` • Gatilho: ${s.possibleTrigger}` : ""}`,
          date: s.date,
        });
      }
    }

    // 5. Search Labs
    if (searchAll || entityTypes.includes("labs")) {
      const labs = await db.labTest.findMany({
        where: {
          userId,
          OR: [
            { markerName: { contains: q, mode: "insensitive" } },
            { testName: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
          ],
        },
        take: limit,
      });

      for (const l of labs) {
        results.push({
          entityType: "lab",
          entityId: l.id,
          title: `Exame: ${l.markerName}`,
          summary: `${l.resultValue} ${l.unit} (${l.testName} • ${l.flag})`,
          date: l.testDate,
        });
      }
    }

    // 6. Search Foods
    if (searchAll || entityTypes.includes("foods")) {
      const foods = await db.food.findMany({
        where: {
          name: { contains: q, mode: "insensitive" },
        },
        take: limit,
      });

      for (const f of foods) {
        results.push({
          entityType: "food",
          entityId: f.id,
          title: f.name,
          summary: `${f.caloriesPer100} kcal/100g (P: ${f.proteinPer100}g, C: ${f.carbsPer100}g, G: ${f.fatPer100}g)`,
        });
      }
    }

    return results.slice(0, limit);
  }
}
