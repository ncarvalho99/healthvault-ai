import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const userData = await db.user.findUnique({
    where: { id: user!.userId },
    select: {
      id: true,
      username: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!userData) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: userData });
}
