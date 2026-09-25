import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ActorType } from "@prisma/client";
import { assertOwnedRefs, ownershipErrorResponse, stripForeignRelation } from "@/lib/ownership";

const createMedicationSchema = z.object({
  recommendationId: z.string().uuid().optional(),
  name: z.string().min(1, "Medication name is required"),
  genericName: z.string().optional(),
  brandName: z.string().optional(),
  category: z.string().optional(),
  form: z.string().optional(),
  // Initial Version parameters
  doseValue: z.number().positive("Dose value must be positive"),
  doseUnit: z.string().min(1, "Dose unit is required"),
  frequency: z.string().min(1, "Frequency is required"),
  schedule: z.string().optional(),
  route: z.string().optional(),
  startDate: z.string().optional(),
  instructions: z.string().optional(),
  changeReason: z.string().optional().default("Initial medication initiation"),
  conversationId: z.string().uuid().optional(),
  // Provenance (actorType/actorName) is fixed server-side: a manual change is always the
  // authenticated user's. DOCTOR/AI actors are only recorded by their own trusted paths.
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("active") !== "false";

  const medications = await db.medication.findMany({
    where: {
      userId: user!.userId,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      recommendation: { select: { id: true, title: true, status: true, userId: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
      _count: {
        select: { versions: true },
      },
    },
  });

  return NextResponse.json({
    medications: medications.map((row) => stripForeignRelation(row, "recommendation", user!.userId)),
  });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createMedicationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const {
      recommendationId,
      name,
      genericName,
      brandName,
      category,
      form,
      doseValue,
      doseUnit,
      frequency,
      schedule,
      route,
      startDate,
      instructions,
      changeReason,
      conversationId,
    } = result.data;
    const actorType = ActorType.USER;
    const actorName = user!.username;

    await assertOwnedRefs(user!.userId, { conversationId, recommendationId });

    const medication = await db.$transaction(async (tx) => {
      const med = await tx.medication.create({
        data: {
          userId: user!.userId,
          recommendationId,
          name,
          genericName,
          brandName,
          category,
          form,
          isActive: true,
        },
      });

      await tx.medicationVersion.create({
        data: {
          medicationId: med.id,
          versionNumber: 1,
          doseValue,
          doseUnit,
          frequency,
          schedule,
          route,
          startDate: startDate ? new Date(startDate) : new Date(),
          instructions,
          changeReason,
          conversationId,
          actorType,
          actorName,
        },
      });

      return med;
    });

    await logAudit({
      userId: user!.userId,
      action: "MEDICATION_CREATED",
      entity: "MEDICATION",
      entityId: medication.id,
      ipAddress: ip,
      userAgent,
      metadata: { name, dose: `${doseValue} ${doseUnit}`, frequency },
    });

    return NextResponse.json({ medication }, { status: 201 });
  } catch (error) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Create medication error:", error);
    return NextResponse.json(
      { error: "Failed to create medication" },
      { status: 500 }
    );
  }
}
