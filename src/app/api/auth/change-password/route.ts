import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = changePasswordSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid password format", details: result.error.format() },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword } = result.data;
    const dbUser = await db.user.findUnique({
      where: { id: user!.userId },
    });

    if (!dbUser || !(await verifyPassword(currentPassword, dbUser.passwordHash))) {
      await logAudit({
        userId: user!.userId,
        action: "PASSWORD_CHANGE_FAILED",
        entity: "AUTH",
        ipAddress: ip,
        userAgent,
        metadata: { reason: "Incorrect current password" },
      });

      return NextResponse.json(
        { error: "Incorrect current password" },
        { status: 401 }
      );
    }

    const newHash = await hashPassword(newPassword);
    await db.user.update({
      where: { id: user!.userId },
      data: { passwordHash: newHash },
    });

    await logAudit({
      userId: user!.userId,
      action: "PASSWORD_CHANGED",
      entity: "AUTH",
      entityId: user!.userId,
      ipAddress: ip,
      userAgent,
      metadata: { status: "Success" },
    });

    return NextResponse.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }
}
