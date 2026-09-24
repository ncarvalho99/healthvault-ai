import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const models = await db.aiModel.findMany({
    where: {
      integration: { userId: user!.userId, enabled: true },
    },
    orderBy: [{ isCombo: "desc" }, { displayName: "asc" }],
    include: {
      integration: { select: { id: true, name: true, defaultCombo: true, defaultModel: true } },
    },
  });

  return NextResponse.json({ models });
}
