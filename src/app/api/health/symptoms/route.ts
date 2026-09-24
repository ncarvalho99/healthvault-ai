import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const createSymptomSchema = z.object({
  symptom: z.string().min(1, "Symptom name is required"),
  severity: z.number().int().min(1).max(10, "Severity must be between 1 and 10"),
  date: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  description: z.string().optional(),
  possibleTrigger: z.string().optional(),
  medicationId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const symptoms = await db.symptom.findMany({
    where: { userId: user!.userId },
    orderBy: { date: "desc" },
    include: {
      medication: { select: { id: true, name: true } },
      conversation: { select: { id: true, title: true } },
    },
  });

  return NextResponse.json({ symptoms });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createSymptomSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      symptom,
      severity,
      date,
      startTime,
      endTime,
      description,
      possibleTrigger,
      medicationId,
      conversationId,
    } = result.data;

    const symptomEntry = await db.symptom.create({
      data: {
        userId: user!.userId,
        symptom,
        severity,
        date: date ? new Date(date) : new Date(),
        startTime,
        endTime,
        description,
        possibleTrigger,
        medicationId,
        conversationId,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "SYMPTOM_CREATED",
      entity: "SYMPTOM",
      entityId: symptomEntry.id,
      ipAddress: ip,
      userAgent,
      metadata: { symptom, severity },
    });

    return NextResponse.json({ symptom: symptomEntry }, { status: 201 });
  } catch (error) {
    console.error("Create symptom error:", error);
    return NextResponse.json(
      { error: "Failed to create symptom" },
      { status: 500 }
    );
  }
}
