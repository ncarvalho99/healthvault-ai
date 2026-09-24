import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
  const action = url.searchParams.get("action");

  const auditLogs = await db.auditLog.findMany({
    where: action ? { action } : {},
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return NextResponse.json({ auditLogs });
}
