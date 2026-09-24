import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const dbUser = await db.user.findUnique({
    where: { id: user!.userId },
    select: { id: true, role: true, allowedModels: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 1. Check if user has their own integration models, otherwise fallback to system enabled integration
  let whereClause: any = {
    integration: { userId: user!.userId, enabled: true },
  };

  const count = await db.aiModel.count({ where: whereClause });
  if (count === 0) {
    whereClause = {
      integration: { enabled: true },
    };
  }

  let models = await db.aiModel.findMany({
    where: whereClause,
    orderBy: [{ isCombo: "desc" }, { displayName: "asc" }],
    include: {
      integration: { select: { id: true, name: true, defaultCombo: true, defaultModel: true } },
    },
  });

  // 2. If user is a standard USER, filter to only the models authorized by admin
  if (dbUser.role === Role.USER) {
    const allowed = new Set(dbUser.allowedModels || []);
    models = models.filter((m) => allowed.has(m.externalId) || allowed.has(m.id));
  }

  return NextResponse.json({
    models,
    role: dbUser.role,
    allowedModels: dbUser.role === Role.ADMIN ? ["*"] : dbUser.allowedModels,
  });
}
