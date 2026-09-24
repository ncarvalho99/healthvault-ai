import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.medication.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Medication not found" }, { status: 404 });
  }

  await db.medication.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "MEDICATION_DELETED",
    entity: "MEDICATION",
    entityId: params.id,
    metadata: { name: existing.name },
  });

  return NextResponse.json({ success: true, message: "Medicamento excluído com sucesso" });
}
