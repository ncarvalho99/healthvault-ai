import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertOwnedRefs, ownershipErrorResponse, stripForeignRelation } from "@/lib/ownership";

const createMetricSchema = z.object({
  date: z.string().optional(),
  weightKg: z.number().positive("Weight must be positive"),
  bodyFatPct: z.number().min(0).max(100).optional(),
  muscleMassKg: z.number().positive().optional(),
  waistCm: z.number().positive().optional(),
  chestCm: z.number().positive().optional(),
  notes: z.string().optional(),
  conversationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const metrics = await db.bodyMetric.findMany({
    where: { userId: user!.userId },
    orderBy: { date: "desc" },
    include: {
      conversation: { select: { id: true, title: true, userId: true } },
    },
  });

  return NextResponse.json({
    metrics: metrics.map((row) => stripForeignRelation(row, "conversation", user!.userId)),
  });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createMetricSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      date,
      weightKg,
      bodyFatPct,
      muscleMassKg,
      waistCm,
      chestCm,
      notes,
      conversationId,
    } = result.data;

    await assertOwnedRefs(user!.userId, { conversationId });

    const metric = await db.bodyMetric.create({
      data: {
        userId: user!.userId,
        date: date ? new Date(date) : new Date(),
        weightKg,
        bodyFatPct,
        muscleMassKg,
        waistCm,
        chestCm,
        notes,
        conversationId,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "BODY_METRIC_CREATED",
      entity: "BODY_METRIC",
      entityId: metric.id,
      ipAddress: ip,
      userAgent,
      metadata: { weightKg, bodyFatPct },
    });

    return NextResponse.json({ metric }, { status: 201 });
  } catch (error) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Create metric error:", error);
    return NextResponse.json(
      { error: "Failed to create metric" },
      { status: 500 }
    );
  }
}
