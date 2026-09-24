import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const updateMetricSchema = z.object({
  weightKg: z.number().positive().optional(),
  bodyFatPct: z.number().min(0).max(100).optional().nullable(),
  muscleMassKg: z.number().positive().optional().nullable(),
  waistCm: z.number().positive().optional().nullable(),
  chestCm: z.number().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = updateMetricSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const existing = await db.bodyMetric.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Metric record not found" }, { status: 404 });
    }

    const updated = await db.bodyMetric.update({
      where: { id: params.id },
      data: result.data,
    });

    await logAudit({
      userId: user!.userId,
      action: "BODY_METRIC_UPDATED",
      entity: "BODY_METRIC",
      entityId: params.id,
      metadata: result.data,
    });

    return NextResponse.json({ metric: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update metric" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.bodyMetric.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Metric record not found" }, { status: 404 });
  }

  await db.bodyMetric.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "BODY_METRIC_DELETED",
    entity: "BODY_METRIC",
    entityId: params.id,
    metadata: { weightKg: existing.weightKg },
  });

  return NextResponse.json({ success: true, message: "Medida excluída com sucesso" });
}
