import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const reminders = await db.reminder.findMany({
    where: { userId: user!.userId, isCompleted: false },
    orderBy: { dueDate: "asc" },
    take: 5,
  });

  return NextResponse.json({ reminders });
}
