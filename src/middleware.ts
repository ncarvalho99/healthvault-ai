import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "healthvault_default_secure_session_secret_replace_in_production";
const secretKey = new TextEncoder().encode(JWT_SECRET);

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/health",
  "/favicon.ico",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Allow public static assets and internal Next.js paths
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    // If user is already authenticated and visits /login, redirect to dashboard
    if (pathname === "/login") {
      const token = req.cookies.get("healthvault_session")?.value;
      if (token) {
        try {
          await jwtVerify(token, secretKey);
          return NextResponse.redirect(new URL("/", req.url));
        } catch {
          // Token invalid, allow /login
        }
      }
    }
    return NextResponse.next();
  }

  // 2. Check for session cookie
  const token = req.cookies.get("healthvault_session")?.value;

  let isAuthenticated = false;
  if (token) {
    try {
      await jwtVerify(token, secretKey);
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  // 3. If unauthenticated:
  if (!isAuthenticated) {
    // API routes return 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // Web pages redirect to /login
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    const response = NextResponse.redirect(loginUrl);
    // Clear stale cookie if present
    response.cookies.delete("healthvault_session");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
