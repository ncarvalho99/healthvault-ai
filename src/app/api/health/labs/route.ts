import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { LabFlag } from "@prisma/client";

const createLabTestSchema = z.object({
  testName: z.string().min(1, "Test name is required"),
  category: z.string().min(1, "Category is required"),
  testDate: z.string(),
  markerName: z.string().min(1, "Marker name is required"),
  resultValue: z.number(),
  unit: z.string().min(1, "Unit is required"),
  referenceRangeLow: z.number().optional(),
  referenceRangeHigh: z.number().optional(),
  flag: z.nativeEnum(LabFlag).default(LabFlag.NORMAL),
  notes: z.string().optional(),
  conversationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const labs = await db.labTest.findMany({
    where: { userId: user!.userId },
    orderBy: { testDate: "desc" },
    include: {
      conversation: { select: { id: true, title: true } },
    },
  });

  return NextResponse.json({ labs });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createLabTestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      testName,
      category,
      testDate,
      markerName,
      resultValue,
      unit,
      referenceRangeLow,
      referenceRangeHigh,
      flag,
      notes,
      conversationId,
    } = result.data;

    const lab = await db.labTest.create({
      data: {
        userId: user!.userId,
        testName,
        category,
        testDate: new Date(testDate),
        markerName,
        resultValue,
        unit,
        referenceRangeLow,
        referenceRangeHigh,
        flag,
        notes,
        conversationId,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "LAB_TEST_CREATED",
      entity: "LAB_TEST",
      entityId: lab.id,
      ipAddress: ip,
      userAgent,
      metadata: { markerName, resultValue: `${resultValue} ${unit}`, flag },
    });

    return NextResponse.json({ lab }, { status: 201 });
  } catch (error) {
    console.error("Create lab test error:", error);
    return NextResponse.json(
      { error: "Failed to create lab test" },
      { status: 500 }
    );
  }
}
