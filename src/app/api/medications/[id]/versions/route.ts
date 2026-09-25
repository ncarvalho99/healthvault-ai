import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ActorType } from "@prisma/client";
import { assertOwnedRefs, ownershipErrorResponse } from "@/lib/ownership";

const createMedicationVersionSchema = z.object({
  doseValue: z.number().positive("Dose value must be positive"),
  doseUnit: z.string().min(1, "Dose unit is required"),
  frequency: z.string().min(1, "Frequency is required"),
  schedule: z.string().optional(),
  route: z.string().optional(),
  startDate: z.string().optional(),
  instructions: z.string().optional(),
  changeReason: z.string().min(1, "A change reason is required to maintain version traceability"),
  conversationId: z.string().uuid().optional(),
  // Provenance (actorType/actorName) is fixed server-side: a manual change is always the
  // authenticated user's. DOCTOR/AI actors are only recorded by their own trusted paths.
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const medication = await db.medication.findFirst({
    where: { id: params.id, userId: user!.userId },
    select: { id: true, name: true },
  });

  if (!medication) {
    return NextResponse.json({ error: "Medication not found" }, { status: 404 });
  }

  const versions = await db.medicationVersion.findMany({
    where: { medicationId: params.id },
    orderBy: { versionNumber: "desc" },
  });

  return NextResponse.json({ medicationName: medication.name, versions });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = createMedicationVersionSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.format() },
        { status: 400 }
      );
    }

    const medication = await db.medication.findFirst({
      where: { id: params.id, userId: user!.userId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });

    if (!medication) {
      return NextResponse.json({ error: "Medication not found" }, { status: 404 });
    }

    const latestVersion = medication.versions[0];
    const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

    const {
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

    await assertOwnedRefs(user!.userId, { conversationId });

    const newVersion = await db.$transaction(async (tx) => {
      // 1. Mark end date on previous version if applicable
      if (latestVersion && !latestVersion.endDate) {
        await tx.medicationVersion.update({
          where: { id: latestVersion.id },
          data: { endDate: new Date() },
        });
      }

      // 2. Create new version
      const ver = await tx.medicationVersion.create({
        data: {
          medicationId: medication.id,
          versionNumber: nextVersionNumber,
          doseValue,
          doseUnit,
          frequency,
          schedule: schedule || latestVersion?.schedule,
          route: route || latestVersion?.route,
          startDate: startDate ? new Date(startDate) : new Date(),
          instructions,
          changeReason,
          conversationId,
          actorType,
          actorName,
        },
      });

      // 3. Touch medication updated_at
      await tx.medication.update({
        where: { id: medication.id },
        data: { updatedAt: new Date(), isActive: true },
      });

      return ver;
    });

    await logAudit({
      userId: user!.userId,
      action: "MEDICATION_VERSION_CREATED",
      entity: "MEDICATION",
      entityId: medication.id,
      ipAddress: ip,
      userAgent,
      metadata: {
        medicationName: medication.name,
        newVersion: nextVersionNumber,
        newDose: `${doseValue} ${doseUnit}`,
        previousDose: latestVersion ? `${latestVersion.doseValue} ${latestVersion.doseUnit}` : null,
        changeReason,
        actorType,
      },
    });

    return NextResponse.json({ version: newVersion }, { status: 201 });
  } catch (error) {
    const ownership = ownershipErrorResponse(error);
    if (ownership) return ownership;
    console.error("Create medication version error:", error);
    return NextResponse.json(
      { error: "Failed to create medication version" },
      { status: 500 }
    );
  }
}
