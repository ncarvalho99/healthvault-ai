import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { RecommendationService } from "@/lib/services/recommendation-service";
import { RecommendationStatus, SourceType, ActorType } from "@prisma/client";

const createRecommendationSchema = z.object({
  conversationId: z.string().uuid().optional(),
  title: z.string().min(1, "Title is required"),
  // Provenance (source, actor, origin) is fixed server-side: manual creation is always user-authored.
  // AI-created protocols go through the agent tools instead.
  status: z.nativeEnum(RecommendationStatus).default(RecommendationStatus.USER_NOTE),
  notes: z.string().optional(),
  summarySnapshot: z.record(z.any()).default({}),
  changeReason: z.string().optional().default("Initial recommendation snapshot"),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  const status = url.searchParams.get("status") as RecommendationStatus | null;

  const whereClause: any = { userId: user!.userId };
  if (conversationId) whereClause.conversationId = conversationId;
  if (status) whereClause.status = status;

  const recommendations = await db.recommendation.findMany({
    where: whereClause,
    orderBy: { updatedAt: "desc" },
    include: {
      conversation: { select: { id: true, title: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
      medications: {
        where: { isActive: true },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  return NextResponse.json({ recommendations });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createRecommendationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      conversationId,
      title,
      status,
      notes,
      changeReason,
    } = result.data;

    // Create Recommendation AND Version 1 using central service and authoritative server-side snapshot
    const recommendation = await RecommendationService.create(user!.userId, {
      conversationId,
      title,
      status,
      sourceType: SourceType.USER_NOTE,
      sourceName: user!.username,
      notes,
      changeReason,
      actorType: ActorType.USER,
      actorName: user!.username,
      informationOrigin: "USER_REPORTED",
      // RecommendationService owns the RECOMMENDATION_CREATED audit
      auditContext: { ipAddress: ip, userAgent },
    });

    return NextResponse.json({ recommendation }, { status: 201 });
  } catch (error) {
    console.error("Create recommendation error:", error);
    return NextResponse.json(
      { error: "Failed to create recommendation" },
      { status: 500 }
    );
  }
}
