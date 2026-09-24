import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { ToolDispatcher } from "@/lib/ai/tools/dispatcher";
import { logAudit } from "@/lib/audit";

const updatePolicySchema = z.object({
  recommendations: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
  nutrition: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
  metrics: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
  symptoms: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
  labs: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
  medications: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
  dosageChanges: z.enum(["AUTO_APPLY", "REVIEW_FIRST"]).optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const policy = await ToolDispatcher.getUserWritePolicy(user!.userId);
  return NextResponse.json({ policy });
}

export async function PUT(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const result = updatePolicySchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const updated = await db.aiWritePolicy.upsert({
      where: { userId: user!.userId },
      update: result.data,
      create: {
        userId: user!.userId,
        ...result.data,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "AI_WRITE_POLICY_UPDATED",
      entity: "AI_WRITE_POLICY",
      entityId: updated.id,
      metadata: result.data,
    });

    return NextResponse.json({ policy: updated });
  } catch (error: any) {
    console.error("Update policy error:", error);
    return NextResponse.json({ error: "Failed to update AI write policy" }, { status: 500 });
  }
}
