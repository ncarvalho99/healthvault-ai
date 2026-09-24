import { db } from "../db";
import { logAudit } from "../audit";

export interface CreateDietInput {
  title: string;
  goal?: string;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  changeReason?: string;
  conversationId?: string;
  informationOrigin?: string;
}

export interface UpdateDietInput {
  dietPlanId?: string;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  changeReason: string;
  conversationId?: string;
  informationOrigin?: string;
}

export class DietService {
  static async getCurrent(userId: string) {
    return db.dietPlan.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: {
            meals: {
              include: {
                foods: {
                  include: { food: true },
                },
              },
            },
          },
        },
      },
    });
  }

  static async create(userId: string, input: CreateDietInput) {
    const diet = await db.$transaction(async (tx) => {
      const plan = await tx.dietPlan.create({
        data: {
          userId,
          title: input.title,
          goal: input.goal,
          currentVersion: 1,
          isActive: true,
        },
      });

      await tx.dietVersion.create({
        data: {
          dietPlanId: plan.id,
          versionNumber: 1,
          targetCalories: input.targetCalories,
          targetProteinG: input.targetProteinG,
          targetCarbsG: input.targetCarbsG,
          targetFatG: input.targetFatG,
          changeReason: input.changeReason || "Plano nutricional inicial",
          conversationId: input.conversationId,
          informationOrigin: input.informationOrigin || "USER_REPORTED",
        },
      });

      return plan;
    });

    await logAudit({
      userId,
      action: "DIET_CREATED",
      entity: "DIET_PLAN",
      entityId: diet.id,
      metadata: {
        title: diet.title,
        calories: input.targetCalories,
        protein: input.targetProteinG,
      },
    });

    return diet;
  }

  static async update(userId: string, input: UpdateDietInput) {
    let plan = input.dietPlanId
      ? await db.dietPlan.findFirst({ where: { id: input.dietPlanId, userId } })
      : await db.dietPlan.findFirst({ where: { userId, isActive: true }, orderBy: { updatedAt: "desc" } });

    if (!plan) {
      // Auto-create base plan if none exists
      plan = await db.dietPlan.create({
        data: {
          userId,
          title: "Plano Nutricional Principal",
          currentVersion: 0,
          isActive: true,
        },
      });
    }

    const nextVersionNumber = plan.currentVersion + 1;

    const result = await db.$transaction(async (tx) => {
      const ver = await tx.dietVersion.create({
        data: {
          dietPlanId: plan.id,
          versionNumber: nextVersionNumber,
          targetCalories: input.targetCalories,
          targetProteinG: input.targetProteinG,
          targetCarbsG: input.targetCarbsG,
          targetFatG: input.targetFatG,
          changeReason: input.changeReason,
          conversationId: input.conversationId,
          informationOrigin: input.informationOrigin || "AI_SUGGESTED",
        },
      });

      const updatedPlan = await tx.dietPlan.update({
        where: { id: plan.id },
        data: {
          currentVersion: nextVersionNumber,
          updatedAt: new Date(),
        },
      });

      return { plan: updatedPlan, version: ver };
    });

    await logAudit({
      userId,
      action: "DIET_VERSION_CREATED",
      entity: "DIET_PLAN",
      entityId: plan.id,
      metadata: {
        planTitle: plan.title,
        newVersion: nextVersionNumber,
        calories: input.targetCalories,
        protein: input.targetProteinG,
        reason: input.changeReason,
      },
    });

    return result;
  }
}
