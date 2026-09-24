import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { LabFlag } from "@prisma/client";

const updateLabSchema = z.object({
  testName: z.string().min(1).optional(),
  markerName: z.string().min(1).optional(),
  resultValue: z.number().optional(),
  unit: z.string().min(1).optional(),
  referenceRangeLow: z.number().optional().nullable(),
  referenceRangeHigh: z.number().optional().nullable(),
  flag: z.nativeEnum(LabFlag).optional(),
  notes: z.string().optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = updateLabSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const existing = await db.labTest.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Lab record not found" }, { status: 404 });
    }

    const updated = await db.labTest.update({
      where: { id: params.id },
      data: result.data,
    });

    await logAudit({
      userId: user!.userId,
      action: "LAB_TEST_UPDATED",
      entity: "LAB_TEST",
      entityId: params.id,
      metadata: result.data,
    });

    return NextResponse.json({ lab: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update lab" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.labTest.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Lab record not found" }, { status: 404 });
  }

  await db.labTest.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "LAB_TEST_DELETED",
    entity: "LAB_TEST",
    entityId: params.id,
    metadata: { markerName: existing.markerName },
  });

  return NextResponse.json({ success: true, message: "Exame excluído com sucesso" });
}
