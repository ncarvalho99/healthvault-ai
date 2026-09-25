import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertOwnedRefs, ownershipErrorResponse } from "@/lib/ownership";

const createDietPlanSchema = z.object({
  title: z.string().min(1, "Diet plan title is required"),
  goal: z.string().optional(),
  targetCalories: z.number().int().positive("Target calories must be positive"),
  targetProteinG: z.number().positive("Target protein must be positive"),
  targetCarbsG: z.number().positive("Target carbs must be positive"),
  targetFatG: z.number().positive("Target fat must be positive"),
  changeReason: z.string().optional().default("Initial diet baseline"),
  conversationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const dietPlans = await db.dietPlan.findMany({
    where: { userId: user!.userId },
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

  return NextResponse.json({ dietPlans });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createDietPlanSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      title,
      goal,
      targetCalories,
      targetProteinG,
      targetCarbsG,
      targetFatG,
      changeReason,
      conversationId,
    } = result.data;

    await assertOwnedRefs(user!.userId, { conversationId });

    const dietPlan = await db.$transaction(async (tx) => {
      const plan = await tx.dietPlan.create({
        data: {
          userId: user!.userId,
          title,
          goal,
          currentVersion: 1,
          isActive: true,
        },
      });

      await tx.dietVersion.create({
        data: {
          dietPlanId: plan.id,
          versionNumber: 1,
          targetCalories,
          targetProteinG,
          targetCarbsG,
          targetFatG,
          changeReason,
          conversationId,
        },
      });

      return plan;
    });

    await logAudit({
      userId: user!.userId,
      action: "DIET_CREATED",
      entity: "DIET_PLAN",
      entityId: dietPlan.id,
      ipAddress: ip,
      userAgent,
      metadata: { title, targetCalories, targetProteinG },
    });

    return NextResponse.json({ dietPlan }, { status: 201 });
  } catch (error) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Create diet plan error:", error);
    return NextResponse.json(
      { error: "Failed to create diet plan" },
      { status: 500 }
    );
  }
}
