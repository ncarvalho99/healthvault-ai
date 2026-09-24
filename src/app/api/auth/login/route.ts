import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword, createSessionToken } from "@/lib/auth";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { checkRateLimit, resetRateLimit } from "@/lib/security";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  try {
    const body = await req.json();
    const result = loginSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid credentials format", details: result.error.format() },
        { status: 400 }
      );
    }

    const { username, password } = result.data;
    const rateLimitKey = `login:${ip}:${username.toLowerCase()}`;

    // Rate limiting: 5 attempts per 15 minutes
    const rateLimit = checkRateLimit(rateLimitKey, 5, 900);
    if (!rateLimit.success) {
      await logAudit({
        action: "LOGIN_RATE_LIMITED",
        entity: "AUTH",
        ipAddress: ip,
        userAgent,
        metadata: { username, retryAfterSeconds: rateLimit.retryAfterSeconds },
      });

      return NextResponse.json(
        {
          error: `Too many login attempts. Please try again in ${rateLimit.retryAfterSeconds} seconds.`,
          code: "RATE_LIMITED",
        },
        { status: 429 }
      );
    }

    const user = await db.user.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await logAudit({
        userId: user?.id,
        action: "LOGIN_FAILED",
        entity: "AUTH",
        ipAddress: ip,
        userAgent,
        metadata: { attemptedUsername: username },
      });

      return NextResponse.json(
        { error: "Invalid username or password", code: "INVALID_CREDENTIALS" },
        { status: 401 }
      );
    }

    // Success: reset rate limiter
    resetRateLimit(rateLimitKey);

    const token = await createSessionToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    // Update last login
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logAudit({
      userId: user.id,
      action: "LOGIN_SUCCESS",
      entity: "AUTH",
      entityId: user.id,
      ipAddress: ip,
      userAgent,
      metadata: { username: user.username },
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });

    const isHttps = req.headers.get("x-forwarded-proto") === "https" || req.url.startsWith("https");

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login route error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during login" },
      { status: 500 }
    );
  }
}
