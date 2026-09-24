import { HealthVaultTool, OpenAIToolDefinition } from "./types";
import { z } from "zod";
import { MedicationService } from "../../services/medication-service";
import { RecommendationService } from "../../services/recommendation-service";
import { DietService } from "../../services/diet-service";
import { HealthService } from "../../services/health-service";
import { db } from "../../db";
import { ActorType } from "@prisma/client";

class ToolRegistryClass {
  private tools = new Map<string, HealthVaultTool>();

  register(tool: HealthVaultTool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): HealthVaultTool | undefined {
    return this.tools.get(name);
  }

  getAll(): HealthVaultTool[] {
    return Array.from(this.tools.values()).filter((t) => t.enabled);
  }

  toOpenAITools(toolsList?: HealthVaultTool[]): OpenAIToolDefinition[] {
    const list = toolsList || this.getAll();

    return list.map((tool) => {
      // Generate standard OpenAI JSON schema from tool.inputSchema
      const shape = (tool.inputSchema as any).shape || {};
      const properties: Record<string, any> = {};
      const required: string[] = [];

      for (const [key, schema] of Object.entries(shape)) {
        const zodType = schema as any;
        const typeName = zodType._def?.typeName;

        let jsonType = "string";
        let description = zodType._def?.description || "";
        let enumVals: string[] | undefined = undefined;

        if (typeName === "ZodNumber") {
          jsonType = "number";
        } else if (typeName === "ZodBoolean") {
          jsonType = "boolean";
        } else if (typeName === "ZodArray") {
          jsonType = "array";
        } else if (typeName === "ZodEnum") {
          jsonType = "string";
          enumVals = zodType._def?.values;
        }

        properties[key] = {
          type: jsonType,
          description,
          ...(enumVals ? { enum: enumVals } : {}),
        };

        if (zodType._def?.typeName !== "ZodOptional" && zodType._def?.typeName !== "ZodNullable") {
          required.push(key);
        }
      }

      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties,
            required,
            additionalProperties: false,
          },
        },
      };
    });
  }
}

export const ToolRegistry = new ToolRegistryClass();

// ==========================================
// 1. SYSTEM & HANDSHAKE
// ==========================================
ToolRegistry.register({
  name: "healthvault_ping",
  version: 1,
  description: "Test ping function used for capability handshake to verify tool calling support.",
  category: "system",
  access: "read",
  risk: "low",
  permission: "system:ping",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    value: z.string().describe("The string 'ping'"),
  }),
  handler: async () => ({
    success: true,
    data: { value: "pong", status: "ok", timestamp: new Date().toISOString() },
  }),
});

// ==========================================
// 2. CONTEXT TOOLS
// ==========================================
ToolRegistry.register({
  name: "healthvault_get_context",
  version: 1,
  description: "Queries structured clinical patient data from HealthVault. Use this to inspect active medications, current diet macros, or recent metrics.",
  category: "context",
  access: "read",
  risk: "low",
  permission: "context:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    include: z.array(z.enum(["medications", "diet", "recommendations", "metrics", "symptoms", "labs"])).describe("List of data categories to include"),
  }),
  handler: async (ctx, args) => {
    const data = await HealthService.getSummaryContext(ctx.userId, args.include);
    return { success: true, data };
  },
});

// ==========================================
// 3. RECOMMENDATIONS
// ==========================================
ToolRegistry.register({
  name: "healthvault_list_recommendations",
  version: 1,
  description: "Lists active and historical clinical recommendations and protocols.",
  category: "recommendations",
  access: "read",
  risk: "low",
  permission: "recommendations:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const recs = await RecommendationService.list(ctx.userId);
    return { success: true, data: recs };
  },
});

ToolRegistry.register({
  name: "healthvault_get_recommendation",
  version: 1,
  description: "Gets the full latest snapshot of a specific recommendation by ID.",
  category: "recommendations",
  access: "read",
  risk: "low",
  permission: "recommendations:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    recommendation_id: z.string().describe("ID of the recommendation"),
  }),
  handler: async (ctx, args) => {
    const rec = await db.recommendation.findFirst({
      where: { id: args.recommendation_id, userId: ctx.userId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!rec) return { success: false, error: { code: "NOT_FOUND", message: "Recomendação não encontrada" } };
    return { success: true, data: rec };
  },
});

ToolRegistry.register({
  name: "healthvault_create_recommendation",
  version: 1,
  description: "Creates a new clinical recommendation snapshot protocol with nutrition and guidance.",
  category: "recommendations",
  access: "write",
  risk: "medium",
  permission: "recommendations:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    title: z.string().describe("Protocol title"),
    notes: z.string().describe("Clinical guidelines and notes"),
    reason: z.string().optional().describe("Reason for this new recommendation"),
  }),
  handler: async (ctx, args) => {
    const rec = await RecommendationService.create(ctx.userId, {
      title: args.title,
      notes: args.notes,
      changeReason: args.reason || "Recomendação proposta pelo assistente",
      conversationId: ctx.conversationId,
      actorType: ActorType.AI,
      informationOrigin: ctx.informationOrigin || "AI_SUGGESTED",
    });
    return { success: true, data: { entity: "recommendation", id: rec.id, title: rec.title, version: 1 } };
  },
});

ToolRegistry.register({
  name: "healthvault_update_recommendation",
  version: 1,
  description: "Updates an existing clinical recommendation protocol, creating an immutable new version.",
  category: "recommendations",
  access: "write",
  risk: "medium",
  permission: "recommendations:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    recommendation_id: z.string().describe("ID of recommendation to update"),
    title: z.string().optional().describe("New title"),
    notes: z.string().optional().describe("Updated notes"),
    reason: z.string().describe("Reason for the clinical change"),
  }),
  handler: async (ctx, args) => {
    const existing = await db.recommendation.findFirst({
      where: { id: args.recommendation_id, userId: ctx.userId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!existing) return { success: false, error: { code: "NOT_FOUND", message: "Recomendação não encontrada" } };

    const updated = await RecommendationService.update(ctx.userId, {
      recommendationId: existing.id,
      title: args.title,
      notes: args.notes,
      summarySnapshot: (existing.versions[0]?.summarySnapshot as any) || {},
      changeReason: args.reason,
      conversationId: ctx.conversationId,
      actorType: ActorType.AI,
      informationOrigin: ctx.informationOrigin || "AI_SUGGESTED",
    });
    return { success: true, data: { entity: "recommendation", id: updated.id, version: updated.currentVersion } };
  },
});

// ==========================================
// 4. MEDICATIONS
// ==========================================
ToolRegistry.register({
  name: "healthvault_list_medications",
  version: 1,
  description: "Lists current active and inactive medications registered in HealthVault.",
  category: "medications",
  access: "read",
  risk: "low",
  permission: "medications:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    active_only: z.boolean().optional().describe("Filter only currently active medications (default: true)"),
  }),
  handler: async (ctx, args) => {
    const meds = await MedicationService.list(ctx.userId, args.active_only !== false);
    return {
      success: true,
      data: meds.map((m) => ({
        id: m.id,
        name: m.name,
        form: m.form,
        currentDose: m.versions[0] ? `${m.versions[0].doseValue} ${m.versions[0].doseUnit}` : null,
        frequency: m.versions[0]?.frequency,
        schedule: m.versions[0]?.schedule,
        version: m.versions[0]?.versionNumber,
      })),
    };
  },
});

ToolRegistry.register({
  name: "healthvault_get_medication",
  version: 1,
  description: "Retrieves details of a specific medication by ID or name.",
  category: "medications",
  access: "read",
  risk: "low",
  permission: "medications:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    medication_id: z.string().describe("Medication ID or name"),
  }),
  handler: async (ctx, args) => {
    let med = await MedicationService.getById(ctx.userId, args.medication_id);
    if (!med) med = await MedicationService.findByName(ctx.userId, args.medication_id);
    if (!med) return { success: false, error: { code: "NOT_FOUND", message: `Medicamento '${args.medication_id}' não encontrado.` } };
    return { success: true, data: med };
  },
});

ToolRegistry.register({
  name: "healthvault_get_medication_history",
  version: 1,
  description: "Retrieves the complete versioned dosage history for a medication.",
  category: "medications",
  access: "read",
  risk: "low",
  permission: "medications:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    medication_id: z.string().describe("Medication ID"),
  }),
  handler: async (ctx, args) => {
    const med = await MedicationService.getById(ctx.userId, args.medication_id);
    if (!med) return { success: false, error: { code: "NOT_FOUND", message: "Medicamento não encontrado" } };
    return { success: true, data: { name: med.name, versions: med.versions } };
  },
});

ToolRegistry.register({
  name: "healthvault_create_medication",
  version: 1,
  description: "Creates a new medication record with an initial baseline dosage.",
  category: "medications",
  access: "write",
  risk: "high",
  permission: "medications:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    name: z.string().describe("Medication brand or generic name"),
    generic_name: z.string().optional().describe("Optional generic name"),
    category: z.string().optional().describe("Category (e.g. GLP-1 RA)"),
    form: z.string().optional().describe("Form (e.g. Subcutaneous Injection)"),
    dose_value: z.number().describe("Dose value (e.g. 0.25)"),
    dose_unit: z.string().describe("Unit (e.g. mg, mcg)"),
    frequency: z.string().describe("Frequency (e.g. 1x/semana)"),
    schedule: z.string().optional().describe("Schedule (e.g. Manhã)"),
    reason: z.string().describe("Clinical reason for starting"),
  }),
  handler: async (ctx, args) => {
    const created = await MedicationService.create(ctx.userId, {
      name: args.name,
      genericName: args.generic_name,
      category: args.category,
      form: args.form,
      doseValue: args.dose_value,
      doseUnit: args.dose_unit,
      frequency: args.frequency,
      schedule: args.schedule,
      changeReason: args.reason,
      conversationId: ctx.conversationId,
      actorType: ActorType.AI,
      informationOrigin: ctx.informationOrigin || "AI_SUGGESTED",
    });
    return { success: true, data: { entity: "medication", id: created.id, name: created.name, version: 1 } };
  },
});

ToolRegistry.register({
  name: "healthvault_update_medication",
  version: 1,
  description: "Adjusts medication dosage, frequency or schedule, creating an immutable new version.",
  category: "medications",
  access: "write",
  risk: "high",
  permission: "medications:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    medication_id: z.string().describe("ID or name of medication to update"),
    dose_value: z.number().describe("New dose value"),
    dose_unit: z.string().optional().describe("Dose unit"),
    frequency: z.string().optional().describe("New frequency"),
    schedule: z.string().optional().describe("New schedule"),
    reason: z.string().describe("Clinical reason for dosage adjustment"),
  }),
  handler: async (ctx, args) => {
    let med = await MedicationService.getById(ctx.userId, args.medication_id);
    if (!med) med = await MedicationService.findByName(ctx.userId, args.medication_id);
    if (!med) return { success: false, error: { code: "NOT_FOUND", message: `Medicamento '${args.medication_id}' não encontrado.` } };

    const updated = await MedicationService.updateDose(ctx.userId, {
      medicationId: med.id,
      doseValue: args.dose_value,
      doseUnit: args.dose_unit,
      frequency: args.frequency,
      schedule: args.schedule,
      changeReason: args.reason,
      conversationId: ctx.conversationId,
      actorType: ActorType.AI,
      informationOrigin: ctx.informationOrigin || "AI_SUGGESTED",
    });
    return {
      success: true,
      data: {
        entity: "medication",
        id: med.id,
        name: med.name,
        version: updated.version.versionNumber,
        newDose: `${args.dose_value} ${args.dose_unit || med.versions[0]?.doseUnit || "mg"}`,
      },
    };
  },
});

ToolRegistry.register({
  name: "healthvault_stop_medication",
  version: 1,
  description: "Safely discontinues a medication, recording end date and reason.",
  category: "medications",
  access: "write",
  risk: "high",
  permission: "medications:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    medication_id: z.string().describe("ID or name of medication to stop"),
    reason: z.string().describe("Reason for discontinuing"),
  }),
  handler: async (ctx, args) => {
    let med = await MedicationService.getById(ctx.userId, args.medication_id);
    if (!med) med = await MedicationService.findByName(ctx.userId, args.medication_id);
    if (!med) return { success: false, error: { code: "NOT_FOUND", message: "Medicamento não encontrado" } };

    const stopped = await MedicationService.stopMedication(ctx.userId, med.id, args.reason, ctx.conversationId);
    return { success: true, data: { entity: "medication", id: med.id, status: "stopped", name: med.name } };
  },
});

// ==========================================
// 5. NUTRITION & DIET
// ==========================================
ToolRegistry.register({
  name: "healthvault_get_current_diet",
  version: 1,
  description: "Retrieves current active dietary plan with calorie and macronutrient targets.",
  category: "nutrition",
  access: "read",
  risk: "low",
  permission: "diet:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const diet = await DietService.getCurrent(ctx.userId);
    const v = diet?.versions[0];
    return {
      success: true,
      data: v
        ? {
            planTitle: diet?.title,
            version: v.versionNumber,
            calories: v.targetCalories,
            proteinG: v.targetProteinG,
            carbsG: v.targetCarbsG,
            fatG: v.targetFatG,
          }
        : null,
    };
  },
});

ToolRegistry.register({
  name: "healthvault_get_diet_history",
  version: 1,
  description: "Retrieves history of past dietary versions and macro shifts.",
  category: "nutrition",
  access: "read",
  risk: "low",
  permission: "diet:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const diet = await DietService.getCurrent(ctx.userId);
    if (!diet) return { success: true, data: [] };
    const versions = await db.dietVersion.findMany({
      where: { dietPlanId: diet.id },
      orderBy: { versionNumber: "desc" },
    });
    return { success: true, data: versions };
  },
});

ToolRegistry.register({
  name: "healthvault_create_diet",
  version: 1,
  description: "Creates a new dietary plan.",
  category: "nutrition",
  access: "write",
  risk: "medium",
  permission: "diet:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    title: z.string().describe("Diet plan title"),
    goal: z.string().optional().describe("Goal (e.g. Cutting, Hypertrophy)"),
    target_calories: z.number().describe("Target daily calories (kcal)"),
    target_protein_g: z.number().describe("Target protein (g)"),
    target_carbs_g: z.number().describe("Target carbs (g)"),
    target_fat_g: z.number().describe("Target fat (g)"),
    reason: z.string().optional().describe("Reason for diet creation"),
  }),
  handler: async (ctx, args) => {
    const created = await DietService.create(ctx.userId, {
      title: args.title,
      goal: args.goal,
      targetCalories: args.target_calories,
      targetProteinG: args.target_protein_g,
      targetCarbsG: args.target_carbs_g,
      targetFatG: args.target_fat_g,
      changeReason: args.reason,
      conversationId: ctx.conversationId,
      informationOrigin: ctx.informationOrigin || "AI_SUGGESTED",
    });
    return { success: true, data: { entity: "diet", id: created.id, version: 1 } };
  },
});

ToolRegistry.register({
  name: "healthvault_update_diet",
  version: 1,
  description: "Updates caloric and macronutrient targets, creating an immutable new diet version.",
  category: "nutrition",
  access: "write",
  risk: "medium",
  permission: "diet:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    target_calories: z.number().describe("Total daily calories (kcal)"),
    target_protein_g: z.number().describe("Daily protein (g)"),
    target_carbs_g: z.number().describe("Daily carbs (g)"),
    target_fat_g: z.number().describe("Daily fat (g)"),
    reason: z.string().describe("Reason for changing nutrition targets"),
  }),
  handler: async (ctx, args) => {
    const result = await DietService.update(ctx.userId, {
      targetCalories: args.target_calories,
      targetProteinG: args.target_protein_g,
      targetCarbsG: args.target_carbs_g,
      targetFatG: args.target_fat_g,
      changeReason: args.reason,
      conversationId: ctx.conversationId,
      informationOrigin: ctx.informationOrigin || "AI_SUGGESTED",
    });
    return {
      success: true,
      data: {
        entity: "diet",
        version: result.version.versionNumber,
        calories: args.target_calories,
        proteinG: args.target_protein_g,
      },
    };
  },
});

ToolRegistry.register({
  name: "healthvault_list_foods",
  version: 1,
  description: "Searches or lists registered nutritional foods and their macro breakdown.",
  category: "nutrition",
  access: "read",
  risk: "low",
  permission: "diet:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    search: z.string().optional().describe("Optional search term for food name"),
  }),
  handler: async (_ctx, args) => {
    const foods = await db.food.findMany({
      where: args.search ? { name: { contains: args.search, mode: "insensitive" } } : {},
      take: 20,
    });
    return { success: true, data: foods };
  },
});

ToolRegistry.register({
  name: "healthvault_create_food",
  version: 1,
  description: "Adds a food item to the nutritional table with macros per 100g.",
  category: "nutrition",
  access: "write",
  risk: "low",
  permission: "diet:write",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    name: z.string().describe("Food name (e.g. Peito de Frango Grelhado)"),
    calories_per_100: z.number().describe("Calories per 100g"),
    protein_per_100: z.number().describe("Protein per 100g"),
    carbs_per_100: z.number().describe("Carbs per 100g"),
    fat_per_100: z.number().describe("Fat per 100g"),
  }),
  handler: async (_ctx, args) => {
    const food = await db.food.upsert({
      where: { name: args.name },
      update: {
        caloriesPer100: args.calories_per_100,
        proteinPer100: args.protein_per_100,
        carbsPer100: args.carbs_per_100,
        fatPer100: args.fat_per_100,
      },
      create: {
        name: args.name,
        caloriesPer100: args.calories_per_100,
        proteinPer100: args.protein_per_100,
        carbsPer100: args.carbs_per_100,
        fatPer100: args.fat_per_100,
      },
    });
    return { success: true, data: food };
  },
});

// ==========================================
// 6. BODY METRICS
// ==========================================
ToolRegistry.register({
  name: "healthvault_get_body_metrics",
  version: 1,
  description: "Retrieves recent body weight, body fat %, and measurement history.",
  category: "metrics",
  access: "read",
  risk: "low",
  permission: "metrics:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    limit: z.number().optional().describe("Number of entries to return (default: 10)"),
  }),
  handler: async (ctx, args) => {
    const metrics = await db.bodyMetric.findMany({
      where: { userId: ctx.userId },
      orderBy: { date: "desc" },
      take: args.limit || 10,
    });
    return { success: true, data: metrics };
  },
});

ToolRegistry.register({
  name: "healthvault_add_body_metric",
  version: 1,
  description: "Records a body measurement reported by the user, such as weight, body fat %, or waist circumference.",
  category: "metrics",
  access: "write",
  risk: "low",
  permission: "metrics:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    weight_kg: z.number().describe("Body weight in kg"),
    body_fat_pct: z.number().optional().describe("Estimated body fat %"),
    waist_cm: z.number().optional().describe("Waist circumference in cm"),
    notes: z.string().optional().describe("Notes (e.g. Jejum matinal)"),
  }),
  handler: async (ctx, args) => {
    const metric = await HealthService.addBodyMetric(ctx.userId, {
      weightKg: args.weight_kg,
      bodyFatPct: args.body_fat_pct,
      waistCm: args.waist_cm,
      notes: args.notes,
      conversationId: ctx.conversationId,
    });
    return { success: true, data: { entity: "metric", id: metric.id, weightKg: metric.weightKg } };
  },
});

// ==========================================
// 7. SYMPTOMS
// ==========================================
ToolRegistry.register({
  name: "healthvault_list_symptoms",
  version: 1,
  description: "Lists symptoms or side effects reported by the patient.",
  category: "symptoms",
  access: "read",
  risk: "low",
  permission: "symptoms:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const symptoms = await db.symptom.findMany({
      where: { userId: ctx.userId },
      orderBy: { date: "desc" },
      take: 20,
    });
    return { success: true, data: symptoms };
  },
});

ToolRegistry.register({
  name: "healthvault_add_symptom",
  version: 1,
  description: "Records an observed symptom or side effect with a 1-10 severity rating.",
  category: "symptoms",
  access: "write",
  risk: "low",
  permission: "symptoms:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    symptom: z.string().describe("Symptom name (e.g. Náusea, Cefaleia)"),
    severity: z.number().describe("Severity on scale 1 (mild) to 10 (severe)"),
    possible_trigger: z.string().optional().describe("Suspected trigger (e.g. 24h pós-dose)"),
    description: z.string().optional().describe("Detailed notes"),
  }),
  handler: async (ctx, args) => {
    const symptom = await HealthService.addSymptom(ctx.userId, {
      symptom: args.symptom,
      severity: args.severity,
      possibleTrigger: args.possible_trigger,
      description: args.description,
      conversationId: ctx.conversationId,
    });
    return { success: true, data: { entity: "symptom", id: symptom.id, symptom: symptom.symptom } };
  },
});

// ==========================================
// 8. LABS & BIOMARKERS
// ==========================================
ToolRegistry.register({
  name: "healthvault_list_lab_results",
  version: 1,
  description: "Lists laboratory test biomarker results.",
  category: "labs",
  access: "read",
  risk: "low",
  permission: "labs:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const labs = await db.labTest.findMany({
      where: { userId: ctx.userId },
      orderBy: { testDate: "desc" },
      take: 20,
    });
    return { success: true, data: labs };
  },
});

ToolRegistry.register({
  name: "healthvault_add_lab_result",
  version: 1,
  description: "Records a laboratory test analyte measurement with reference ranges.",
  category: "labs",
  access: "write",
  risk: "medium",
  permission: "labs:write",
  requiresApproval: "policy",
  enabled: true,
  inputSchema: z.object({
    test_name: z.string().describe("Name of the test panel (e.g. Perfil Lipídico)"),
    marker_name: z.string().describe("Marker name (e.g. Glicemia de Jejum, TSH)"),
    result_value: z.number().describe("Numeric result value"),
    unit: z.string().describe("Measurement unit (e.g. mg/dL, UI/mL)"),
    reference_range_low: z.number().optional().describe("Lower reference limit"),
    reference_range_high: z.number().optional().describe("Upper reference limit"),
  }),
  handler: async (ctx, args) => {
    const lab = await HealthService.addLabResult(ctx.userId, {
      testName: args.test_name,
      markerName: args.marker_name,
      resultValue: args.result_value,
      unit: args.unit,
      referenceRangeLow: args.reference_range_low,
      referenceRangeHigh: args.reference_range_high,
      conversationId: ctx.conversationId,
    });
    return { success: true, data: { entity: "lab", id: lab.id, marker: lab.markerName, value: lab.resultValue } };
  },
});

// ==========================================
// 9. REMINDERS & TIMELINE
// ==========================================
ToolRegistry.register({
  name: "healthvault_create_reminder",
  version: 1,
  description: "Creates a reminder for a future review, titration check or lab test.",
  category: "reminders",
  access: "write",
  risk: "low",
  permission: "reminders:write",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    title: z.string().describe("Reminder title"),
    due_date: z.string().describe("Date in ISO format (YYYY-MM-DD)"),
    notes: z.string().optional().describe("Additional context"),
  }),
  handler: async (ctx, args) => {
    const reminder = await HealthService.createReminder(ctx.userId, {
      title: args.title,
      dueDate: args.due_date,
      notes: args.notes,
    });
    return { success: true, data: { entity: "reminder", id: reminder.id, title: reminder.title } };
  },
});

ToolRegistry.register({
  name: "healthvault_get_timeline",
  version: 1,
  description: "Retrieves unified chronological evolution of dosage changes, dietary adjustments, and measurements.",
  category: "timeline",
  access: "read",
  risk: "low",
  permission: "timeline:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({}),
  handler: async (ctx) => {
    // Call internal timeline aggregation
    const res = await fetch(`http://127.0.0.1:3000/api/timeline`);
    if (res.ok) {
      const data = await res.json();
      return { success: true, data: data.events?.slice(0, 15) || [] };
    }
    return { success: true, data: [] };
  },
});

ToolRegistry.register({
  name: "healthvault_search",
  version: 1,
  description: "Searches historical HealthVault records across medications, recommendations, diets, foods, metrics, symptoms, and labs.",
  category: "context",
  access: "read",
  risk: "low",
  permission: "search:read",
  requiresApproval: false,
  enabled: true,
  inputSchema: z.object({
    query: z.string().describe("Search term or clinical query"),
    entity_types: z.array(z.enum(["recommendations", "medications", "diets", "foods", "metrics", "symptoms", "labs"])).optional().describe("Categories to filter (default: all)"),
    limit: z.number().optional().describe("Max number of matches to return (default: 10)"),
  }),
  handler: async (ctx, args) => {
    const { SearchService } = await import("../../services/search-service");
    const results = await SearchService.search({
      userId: ctx.userId,
      query: args.query,
      entityTypes: args.entity_types,
      limit: args.limit || 10,
    });
    return { success: true, data: results };
  },
});
