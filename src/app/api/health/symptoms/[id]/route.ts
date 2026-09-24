import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const updateSymptomSchema = z.object({
  symptom: z.string().min(1).optional(),
  severity: z.number().int().min(1).max(10).optional(),
  description: z.string().optional().nullable(),
  possibleTrigger: z.string().optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = updateSymptomSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const existing = await db.symptom.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Symptom record not found" }, { status: 404 });
    }

    const updated = await db.symptom.update({
      where: { id: params.id },
      data: result.data,
    });

    await logAudit({
      userId: user!.userId,
      action: "SYMPTOM_UPDATED",
      entity: "SYMPTOM",
      entityId: params.id,
      metadata: result.data,
    });

    return NextResponse.json({ symptom: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update symptom" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.symptom.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Symptom record not found" }, { status: 404 });
  }

  await db.symptom.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "SYMPTOM_DELETED",
    entity: "SYMPTOM",
    entityId: params.id,
    metadata: { symptom: existing.symptom },
  });

  return NextResponse.json({ success: true, message: "Sintoma excluído com sucesso" });
}
