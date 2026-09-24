import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.dietPlan.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Diet plan not found" }, { status: 404 });
  }

  await db.dietPlan.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "DIET_DELETED",
    entity: "DIET_PLAN",
    entityId: params.id,
    metadata: { title: existing.title },
  });

  return NextResponse.json({ success: true, message: "Plano nutricional excluído com sucesso" });
}
