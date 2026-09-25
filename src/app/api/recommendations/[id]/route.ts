import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { RecommendationService } from "@/lib/services/recommendation-service";
import { RecommendationStatus, ActorType } from "@prisma/client";
import { assertOwnedConversation, ownershipErrorResponse, stripForeignRelation } from "@/lib/ownership";
import { isManualRecommendationStatusAllowed } from "@/lib/recommendation-origin";

const updateRecommendationSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.nativeEnum(RecommendationStatus).optional(),
  notes: z.string().optional(),
  // summarySnapshot is built server-side (RecommendationService); client values are not accepted.
  changeReason: z.string().min(1, "Change reason is required to maintain clinical audit trail"),
  conversationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const recommendation = await db.recommendation.findFirst({
    where: { id: params.id, userId: user!.userId },
    include: {
      conversation: { select: { id: true, title: true, userId: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
      },
      medications: {
        where: { isActive: true, userId: user!.userId },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!recommendation) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  return NextResponse.json({ recommendation: stripForeignRelation(recommendation, "conversation", user!.userId) });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = updateRecommendationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const existing = await db.recommendation.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    }

    const {
      title,
      status,
      notes,
      changeReason,
      conversationId,
    } = result.data;

    if (status && !isManualRecommendationStatusAllowed(status, existing.sourceType, existing.status)) {
      return NextResponse.json(
        {
          error: "Este status exige uma origem médica verificada e não pode ser atribuído manualmente.",
          code: "STATUS_REQUIRES_TRUSTED_ORIGIN",
        },
        { status: 403 }
      );
    }

    await assertOwnedConversation(user!.userId, conversationId);

    const finalStatus = status || existing.status;

    // Execute atomic update: update recommendation record & create new immutable version using server-side snapshot
    const updated = await RecommendationService.update(user!.userId, {
      recommendationId: existing.id,
      title,
      status: finalStatus,
      notes,
      changeReason,
      conversationId: conversationId || existing.conversationId,
      // Manual edit through the API/UI: provenance fixed server-side
      actorType: ActorType.USER,
      actorName: user!.username,
      informationOrigin: "USER_REPORTED",
      // RecommendationService owns the RECOMMENDATION_VERSION_CREATED audit
      auditContext: { ipAddress: ip, userAgent },
    });

    return NextResponse.json({ recommendation: updated });
  } catch (error) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Update recommendation error:", error);
    return NextResponse.json(
      { error: "Failed to update recommendation" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.recommendation.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  await db.recommendation.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "RECOMMENDATION_DELETED",
    entity: "RECOMMENDATION",
    entityId: params.id,
    ipAddress: ip,
    userAgent,
    metadata: { title: existing.title },
  });

  return NextResponse.json({ success: true, message: "Recomendação excluída com sucesso" });
}
