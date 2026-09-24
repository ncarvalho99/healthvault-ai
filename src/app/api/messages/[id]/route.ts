import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const updateMessageSchema = z.object({
  content: z.string().min(1, "Content cannot be empty"),
  reason: z.string().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = updateMessageSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const message = await db.message.findUnique({
      where: { id: params.id },
      include: {
        conversation: { select: { userId: true } },
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    });

    if (!message || message.conversation.userId !== user!.userId) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const nextVersionNumber = message.versions.length > 0 ? message.versions[0].versionNumber + 1 : 1;

    // Use transaction to archive old content into message_versions and update message
    const updated = await db.$transaction(async (tx) => {
      // 1. Archive current content
      await tx.messageVersion.create({
        data: {
          messageId: message.id,
          versionNumber: nextVersionNumber,
          content: message.content,
          editedBy: user!.username,
          reason: result.data.reason || "Manual edit",
        },
      });

      // 2. Update message
      return tx.message.update({
        where: { id: message.id },
        data: {
          content: result.data.content,
          isEdited: true,
          updatedAt: new Date(),
        },
      });
    });

    await logAudit({
      userId: user!.userId,
      action: "MESSAGE_UPDATED",
      entity: "MESSAGE",
      entityId: message.id,
      ipAddress: ip,
      userAgent,
      metadata: { archivedVersion: nextVersionNumber, reason: result.data.reason },
    });

    return NextResponse.json({ message: updated });
  } catch (error) {
    console.error("Update message error:", error);
    return NextResponse.json(
      { error: "Failed to update message" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const message = await db.message.findUnique({
    where: { id: params.id },
    include: { conversation: { select: { userId: true } } },
  });

  if (!message || message.conversation.userId !== user!.userId) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  await db.message.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "MESSAGE_DELETED",
    entity: "MESSAGE",
    entityId: params.id,
    ipAddress: ip,
    userAgent,
    metadata: { conversationId: message.conversationId },
  });

  return NextResponse.json({ success: true, message: "Message deleted successfully" });
}
