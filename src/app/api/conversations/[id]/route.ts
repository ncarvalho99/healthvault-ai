import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  tags: z.array(z.string()).optional(),
  isFavorite: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  summary: z.string().optional(),
  summaryData: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const conversation = await db.conversation.findFirst({
    where: {
      id: params.id,
      userId: user!.userId,
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            select: {
              id: true,
              versionNumber: true,
              editedBy: true,
              reason: true,
              createdAt: true,
            },
          },
        },
      },
      recommendations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
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
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = updateConversationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const existing = await db.conversation.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const updated = await db.conversation.update({
      where: { id: params.id },
      data: result.data,
    });

    await logAudit({
      userId: user!.userId,
      action: "CONVERSATION_UPDATED",
      entity: "CONVERSATION",
      entityId: updated.id,
      ipAddress: ip,
      userAgent,
      metadata: { changedFields: Object.keys(result.data) },
    });

    return NextResponse.json({ conversation: updated });
  } catch (error) {
    console.error("Update conversation error:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const existing = await db.conversation.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  await db.conversation.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "CONVERSATION_DELETED",
    entity: "CONVERSATION",
    entityId: params.id,
    ipAddress: ip,
    userAgent,
    metadata: { title: existing.title },
  });

  return NextResponse.json({ success: true, message: "Conversation deleted successfully" });
}
