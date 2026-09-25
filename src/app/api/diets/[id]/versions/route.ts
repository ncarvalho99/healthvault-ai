import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertOwnedRefs, ownershipErrorResponse } from "@/lib/ownership";

const createDietVersionSchema = z.object({
  targetCalories: z.number().int().positive("Target calories must be positive"),
  targetProteinG: z.number().positive("Target protein must be positive"),
  targetCarbsG: z.number().positive("Target carbs must be positive"),
  targetFatG: z.number().positive("Target fat must be positive"),
  changeReason: z.string().min(1, "Change reason is required to maintain nutritional audit trail"),
  conversationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const dietPlan = await db.dietPlan.findFirst({
    where: { id: params.id, userId: user!.userId },
    select: { id: true, title: true },
  });

  if (!dietPlan) {
    return NextResponse.json({ error: "Diet plan not found" }, { status: 404 });
  }

  const versions = await db.dietVersion.findMany({
    where: { dietPlanId: params.id },
    orderBy: { versionNumber: "desc" },
    include: {
      meals: {
        include: {
          foods: {
            include: { food: true },
          },
        },
      },
    },
  });

  return NextResponse.json({ dietTitle: dietPlan.title, versions });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createDietVersionSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const dietPlan = await db.dietPlan.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!dietPlan) {
      return NextResponse.json({ error: "Diet plan not found" }, { status: 404 });
    }

    const nextVersionNumber = dietPlan.currentVersion + 1;
    const {
      targetCalories,
      targetProteinG,
      targetCarbsG,
      targetFatG,
      changeReason,
      conversationId,
    } = result.data;

    await assertOwnedRefs(user!.userId, { conversationId });

    const newVersion = await db.$transaction(async (tx) => {
      const ver = await tx.dietVersion.create({
        data: {
          dietPlanId: dietPlan.id,
          versionNumber: nextVersionNumber,
          targetCalories,
          targetProteinG,
          targetCarbsG,
          targetFatG,
          changeReason,
          conversationId,
        },
      });

      await tx.dietPlan.update({
        where: { id: dietPlan.id },
        data: {
          currentVersion: nextVersionNumber,
          updatedAt: new Date(),
        },
      });

      return ver;
    });

    await logAudit({
      userId: user!.userId,
      action: "DIET_VERSION_CREATED",
      entity: "DIET_PLAN",
      entityId: dietPlan.id,
      ipAddress: ip,
      userAgent,
      metadata: {
        dietTitle: dietPlan.title,
        newVersion: nextVersionNumber,
        targetCalories,
        targetProteinG,
        changeReason,
      },
    });

    return NextResponse.json({ version: newVersion }, { status: 201 });
  } catch (error) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Create diet version error:", error);
    return NextResponse.json(
      { error: "Failed to create diet version" },
      { status: 500 }
    );
  }
}
