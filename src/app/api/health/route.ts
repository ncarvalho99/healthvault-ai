import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    // Quick DB query to verify database liveness
    await db.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      database: "ok",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Healthcheck database failure:", error);
    return NextResponse.json(
      {
        status: "degraded",
        database: "unreachable",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
