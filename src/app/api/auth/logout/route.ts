import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, authenticateRequest } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user } = await authenticateRequest(req);

  if (user) {
    await logAudit({
      userId: user.userId,
      action: "LOGOUT",
      entity: "AUTH",
      entityId: user.userId,
      ipAddress: ip,
      userAgent,
      metadata: { username: user.username },
    });
  }

  const response = NextResponse.json({ success: true, message: "Logged out successfully" });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
