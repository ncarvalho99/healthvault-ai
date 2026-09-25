import { db } from "../../db";
import { QuerySanitizer } from "./query-sanitizer";
import {
  ResearchIntentType,
  ResolvedVaultEntity,
  VaultResolutionResult,
} from "./types";

export interface VaultEntityResolverOptions {
  userId?: string;
  userMessage: string;
  intent: ResearchIntentType;
  externalEntities?: string[];
  dbClient?: any;
}

const MEDICATION_REF_PATTERN =
  /\b(meu|meus|minha|minhas|atual|atuais)\s+(medicamento|medicamentos|rem[eé]dio|rem[eé]dios|medica[cç][aã]o|medica[cç][oõ]es|dose|dosagem|tratamento)\b|\b(o que|quais\s+rem[eé]dios|quais\s+medicamentos)\s+(eu\s+tomo|estou\s+tomando)\b|\b(tomo|tomando|usando)\s+atualmente\b/i;

const DIET_REF_PATTERN =
  /\b(minha|meu)\s+(dieta|plano\s+alimentar|alimenta[cç][aã]o|macros|calorias)\b/i;

const BRAND_TO_GENERIC: Record<string, string> = {
  ozempic: "semaglutide",
  wegovy: "semaglutide",
  rybelsus: "semaglutide",
  mounjaro: "tirzepatide",
  zepbound: "tirzepatide",
  glifage: "metformin",
  semaglutida: "semaglutide",
  tirzepatida: "tirzepatide",
  metformina: "metformin",
  retatrutida: "retatrutide",
  creatina: "creatine",
  berberina: "berberine",
};

export class VaultEntityResolver {
  /**
   * Resolves minimal personal health entities from HealthVault required
   * to formulate privacy-preserving external clinical research queries.
   */
  static async resolve(
    options: VaultEntityResolverOptions
  ): Promise<VaultResolutionResult> {
    const { userId, userMessage, intent, externalEntities = [], dbClient } = options;

    // Vault entity resolution is only performed for MIXED research intent when userId is present
    if (intent !== "MIXED" || !userId) {
      return {
        used: false,
        resolvedEntities: [],
        resolvedEntityTypes: [],
        resolvedEntityCount: 0,
        hasAmbiguity: false,
        suggestedQueries: [],
        domainTargetedQueries: [],
      };
    }

    const prisma = dbClient || db;
    const resolvedEntities: ResolvedVaultEntity[] = [];
    let hasAmbiguity = false;
    let ambiguityType: "MULTIPLE_ACTIVE_MEDICATIONS" | undefined;
    let ambiguousItems: string[] | undefined;

    // 1. Resolve Active Medications if referenced in message
    if (MEDICATION_REF_PATTERN.test(userMessage)) {
      try {
        const meds = await prisma.medication.findMany({
          where: { userId, isActive: true },
          include: {
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
          orderBy: { updatedAt: "desc" },
        });

        if (meds.length === 1) {
          const m = meds[0];
          const rawName = (m.genericName || m.name).toLowerCase().trim();
          const canonicalName = BRAND_TO_GENERIC[rawName] || rawName;
          const v = m.versions?.[0];
          resolvedEntities.push({
            type: "medication",
            name: canonicalName,
            dose: v ? `${v.doseValue} ${v.doseUnit}` : undefined,
            form: m.form || undefined,
          });
        } else if (meds.length >= 2) {
          // Multiple active medications detected.
          // Option A: Formulate searches for all active medications (up to 3) without silent omission.
          hasAmbiguity = true;
          ambiguityType = "MULTIPLE_ACTIVE_MEDICATIONS";
          ambiguousItems = meds.map((m: any) => m.name);

          for (const m of meds.slice(0, 3)) {
            const rawName = (m.genericName || m.name).toLowerCase().trim();
            const canonicalName = BRAND_TO_GENERIC[rawName] || rawName;
            const v = m.versions?.[0];
            resolvedEntities.push({
              type: "medication",
              name: canonicalName,
              dose: v ? `${v.doseValue} ${v.doseUnit}` : undefined,
              form: m.form || undefined,
            });
          }
        }
      } catch (err) {
        console.error("VaultEntityResolver: Failed to fetch medications", err);
      }
    }

    // 2. Resolve Diet if referenced in message
    if (DIET_REF_PATTERN.test(userMessage)) {
      try {
        const diet = await prisma.dietPlan.findFirst({
          where: { userId, isActive: true },
          orderBy: { updatedAt: "desc" },
          include: {
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
          },
        });

        if (diet) {
          const v = diet.versions?.[0];
          const title = (diet.title || "diet").toLowerCase().trim();
          resolvedEntities.push({
            type: "diet",
            name: title,
            details: v ? `${v.targetCalories} kcal` : undefined,
          });
        }
      } catch (err) {
        console.error("VaultEntityResolver: Failed to fetch diet", err);
      }
    }

    if (resolvedEntities.length === 0) {
      return {
        used: false,
        resolvedEntities: [],
        resolvedEntityTypes: [],
        resolvedEntityCount: 0,
        hasAmbiguity: false,
        suggestedQueries: [],
        domainTargetedQueries: [],
      };
    }

    // 3. Formulate minimal, privacy-preserving external clinical queries
    const suggested: string[] = [];
    const targeted: string[] = [];

    const resolvedMeds = resolvedEntities.filter((e) => e.type === "medication");
    const normalizedExtEntities = externalEntities.map((e) => {
      const l = e.toLowerCase().trim();
      return BRAND_TO_GENERIC[l] || l;
    });

    if (resolvedMeds.length > 0) {
      for (const med of resolvedMeds) {
        if (normalizedExtEntities.length > 0) {
          for (const ext of normalizedExtEntities) {
            // Drug-drug interaction queries
            suggested.push(`${med.name} ${ext} drug interaction`);
            suggested.push(`${med.name} ${ext} combination safety`);
            targeted.push(`site:fda.gov ${med.name} ${ext}`);
            targeted.push(`site:pubmed.ncbi.nlm.nih.gov ${med.name} ${ext} interaction`);
            targeted.push(`site:clinicaltrials.gov ${med.name} ${ext}`);
          }
        } else {
          // General clinical safety query for resolved medication
          suggested.push(`${med.name} drug interactions contraindications`);
          suggested.push(`${med.name} clinical guidelines dosage`);
          targeted.push(`site:pubmed.ncbi.nlm.nih.gov ${med.name} drug interaction`);
          targeted.push(`site:fda.gov ${med.name} prescribing information`);
        }
      }
    }

    const resolvedDiets = resolvedEntities.filter((e) => e.type === "diet");
    if (resolvedDiets.length > 0 && normalizedExtEntities.length > 0) {
      for (const d of resolvedDiets) {
        for (const ext of normalizedExtEntities) {
          suggested.push(`${ext} diet interaction nutrition`);
          targeted.push(`site:pubmed.ncbi.nlm.nih.gov ${ext} dietary interaction`);
        }
      }
    }

    // 4. Sanitize and minimize all formulated queries
    const knownEntityNames = [
      ...resolvedMeds.map((m) => m.name),
      ...normalizedExtEntities,
    ];

    const sanitizedSuggested = Array.from(
      new Set(
        suggested
          .map((q) => QuerySanitizer.sanitizeAndMinimize(q, knownEntityNames))
          .filter((q) => q.length > 0)
      )
    ).slice(0, 4);

    const sanitizedTargeted = Array.from(
      new Set(
        targeted
          .map((q) => QuerySanitizer.sanitizeAndMinimize(q, knownEntityNames))
          .filter((q) => q.length > 0)
      )
    ).slice(0, 4);

    return {
      used: true,
      resolvedEntities,
      resolvedEntityTypes: Array.from(new Set(resolvedEntities.map((e) => e.type))),
      resolvedEntityCount: resolvedEntities.length,
      hasAmbiguity,
      ambiguityType,
      ambiguousItems,
      suggestedQueries: sanitizedSuggested,
      domainTargetedQueries: sanitizedTargeted,
    };
  }
}
