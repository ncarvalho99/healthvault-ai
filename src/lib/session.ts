import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, TokenPayload } from "./auth";
import { db } from "./db";

export const SESSION_COOKIE_NAME = "healthvault_session";

export async function getSessionUser(): Promise<TokenPayload | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function authenticateRequest(req: NextRequest): Promise<{ user: TokenPayload | null; errorResponse?: NextResponse }> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || req.headers.get("authorization")?.replace("Bearer ", "");
  
  if (!token) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    };
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "Invalid or expired session", code: "SESSION_EXPIRED" },
        { status: 401 }
      ),
    };
  }

  // Check user still exists in database
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, role: true },
  });

  if (!user) {
    return {
      user: null,
      errorResponse: NextResponse.json(
        { error: "User account no longer exists", code: "USER_NOT_FOUND" },
        { status: 401 }
      ),
    };
  }

  return { user: payload };
}
