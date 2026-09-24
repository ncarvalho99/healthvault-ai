import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { SenderType } from "@prisma/client";

const createMessageSchema = z.object({
  senderType: z.nativeEnum(SenderType).default(SenderType.USER),
  senderName: z.string().min(1).default("User"),
  content: z.string().min(1, "Message content cannot be empty"),
  metadata: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const conversation = await db.conversation.findFirst({
    where: { id: params.id, userId: user!.userId },
    select: { id: true },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = await db.message.findMany({
    where: { conversationId: params.id },
    orderBy: { createdAt: "asc" },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
      },
    },
  });

  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createMessageSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const conversation = await db.conversation.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { senderType, senderName, content, metadata } = result.data;

    const message = await db.message.create({
      data: {
        conversationId: params.id,
        senderType,
        senderName,
        content,
        metadata: metadata ? metadata : undefined,
      },
    });

    // Touch conversation updated_at
    await db.conversation.update({
      where: { id: params.id },
      data: { updatedAt: new Date() },
    });

    await logAudit({
      userId: user!.userId,
      action: "MESSAGE_CREATED",
      entity: "MESSAGE",
      entityId: message.id,
      ipAddress: ip,
      userAgent,
      metadata: { conversationId: params.id, senderType, senderName },
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    console.error("Create message error:", error);
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 }
    );
  }
}
