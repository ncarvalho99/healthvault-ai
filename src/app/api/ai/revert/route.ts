import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { RevertService } from "@/lib/services/revert-service";
import { assertOwnedConversation, ownershipErrorResponse } from "@/lib/ownership";

const revertSchema = z.object({
  entityType: z.enum(["medication", "diet", "recommendation"]),
  entityId: z.string().uuid(),
  targetVersionNumber: z.number().int().positive().optional(),
  reason: z.string().optional(),
  conversationId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = revertSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const { entityType, entityId, targetVersionNumber, reason, conversationId } = result.data;

    await assertOwnedConversation(user!.userId, conversationId);

    const reverted = await RevertService.revert({
      userId: user!.userId,
      entityType,
      entityId,
      targetVersionNumber,
      reason,
      conversationId,
    });

    return NextResponse.json({ success: true, reverted });
  } catch (error: any) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Revert error:", error);
    return NextResponse.json({ error: error?.message || "Failed to revert version" }, { status: 500 });
  }
}
