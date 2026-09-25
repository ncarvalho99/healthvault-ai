import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const createConversationSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  tags: z.array(z.string()).optional().default([]),
  summary: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const search = url.searchParams.get("search");
  const favoriteOnly = url.searchParams.get("favorite") === "true";
  const archived = url.searchParams.get("archived") === "true";
  const tag = url.searchParams.get("tag");

  const whereClause: any = {
    userId: user!.userId,
    isArchived: archived,
  };

  if (favoriteOnly) {
    whereClause.isFavorite = true;
  }

  if (tag) {
    whereClause.tags = { has: tag };
  }

  if (search) {
    whereClause.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { summary: { contains: search, mode: "insensitive" } },
    ];
  }

  const conversations = await db.conversation.findMany({
    where: whereClause,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: { messages: true, recommendations: { where: { userId: user!.userId } } },
      },
      recommendations: {
        where: { userId: user!.userId },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          title: true,
          status: true,
          currentVersion: true,
          updatedAt: true,
        },
      },
    },
  });

  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createConversationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const { title, tags, summary } = result.data;

    const conversation = await db.conversation.create({
      data: {
        userId: user!.userId,
        title,
        tags,
        summary,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "CONVERSATION_CREATED",
      entity: "CONVERSATION",
      entityId: conversation.id,
      ipAddress: ip,
      userAgent,
      metadata: { title },
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
