import { db } from "../db";
import { logAudit } from "../audit";
import { ActorType } from "@prisma/client";

export interface CreateMedicationInput {
  name: string;
  genericName?: string;
  brandName?: string;
  category?: string;
  form?: string;
  doseValue: number;
  doseUnit: string;
  frequency: string;
  schedule?: string;
  route?: string;
  startDate?: Date | string;
  instructions?: string;
  changeReason?: string;
  conversationId?: string;
  actorType?: ActorType;
  actorName?: string;
  informationOrigin?: string;
}

export interface UpdateMedicationDoseInput {
  medicationId: string;
  doseValue: number;
  doseUnit?: string;
  frequency?: string;
  schedule?: string;
  route?: string;
  startDate?: Date | string;
  instructions?: string;
  changeReason: string;
  conversationId?: string;
  actorType?: ActorType;
  actorName?: string;
  informationOrigin?: string;
}

export class MedicationService {
  static async list(userId: string, activeOnly = true) {
    return db.medication.findMany({
      where: {
        userId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });
  }

  static async getById(userId: string, id: string, txClient?: any) {
    const client = txClient || db;
    return client.medication.findFirst({
      where: { id, userId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
        },
      },
    });
  }

  static async findByName(userId: string, name: string, txClient?: any) {
    const client = txClient || db;
    return client.medication.findFirst({
      where: {
        userId,
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { genericName: { equals: name, mode: "insensitive" } },
          { brandName: { equals: name, mode: "insensitive" } },
        ],
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });
  }

  static async create(userId: string, input: CreateMedicationInput, txClient?: any) {
    const runInTx = async (tx: any) => {
      const createdMed = await tx.medication.create({
        data: {
          userId,
          name: input.name,
          genericName: input.genericName,
          brandName: input.brandName,
          category: input.category,
          form: input.form,
          isActive: true,
        },
      });

      const version = await tx.medicationVersion.create({
        data: {
          medicationId: createdMed.id,
          versionNumber: 1,
          doseValue: input.doseValue,
          doseUnit: input.doseUnit,
          frequency: input.frequency,
          schedule: input.schedule,
          route: input.route,
          startDate: input.startDate ? new Date(input.startDate) : new Date(),
          instructions: input.instructions,
          changeReason: input.changeReason || "Iniciação do medicamento",
          conversationId: input.conversationId,
          actorType: input.actorType || ActorType.USER,
          actorName: input.actorName,
          informationOrigin: input.informationOrigin || "USER_REPORTED",
        },
      });

      return { ...createdMed, currentVersion: version };
    };

    const med = txClient ? await runInTx(txClient) : await db.$transaction(runInTx);

    await logAudit({
      userId,
      action: "MEDICATION_CREATED",
      entity: "MEDICATION",
      entityId: med.id,
      metadata: {
        name: med.name,
        dose: `${input.doseValue} ${input.doseUnit}`,
        actorType: input.actorType,
        origin: input.informationOrigin,
      },
    });

    return med;
  }

  static async updateDose(userId: string, input: UpdateMedicationDoseInput, txClient?: any) {
    const client = txClient || db;
    const med = await client.medication.findFirst({
      where: { id: input.medicationId, userId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });

    if (!med) {
      throw new Error(`Medication not found for id ${input.medicationId}`);
    }

    const latest = med.versions[0];
    const nextVersionNumber = latest ? latest.versionNumber + 1 : 1;

    const runInTx = async (tx: any) => {
      // Close end date on previous version
      if (latest && !latest.endDate) {
        await tx.medicationVersion.update({
          where: { id: latest.id },
          data: { endDate: new Date() },
        });
      }

      // Create new immutable version
      const newVer = await tx.medicationVersion.create({
        data: {
          medicationId: med.id,
          versionNumber: nextVersionNumber,
          doseValue: input.doseValue,
          doseUnit: input.doseUnit || latest?.doseUnit || "mg",
          frequency: input.frequency || latest?.frequency || "1x/dia",
          schedule: input.schedule !== undefined ? input.schedule : latest?.schedule,
          route: input.route !== undefined ? input.route : latest?.route,
          startDate: input.startDate ? new Date(input.startDate) : new Date(),
          instructions: input.instructions !== undefined ? input.instructions : latest?.instructions,
          changeReason: input.changeReason,
          conversationId: input.conversationId,
          actorType: input.actorType || ActorType.USER,
          actorName: input.actorName,
          informationOrigin: input.informationOrigin || "AI_SUGGESTED",
        },
      });

      // Touch parent medication
      await tx.medication.update({
        where: { id: med.id },
        data: { updatedAt: new Date(), isActive: true },
      });

      return { medication: med, version: newVer };
    };

    const updated = txClient ? await runInTx(txClient) : await db.$transaction(runInTx);

    await logAudit({
      userId,
      action: "MEDICATION_VERSION_CREATED",
      entity: "MEDICATION",
      entityId: med.id,
      metadata: {
        name: med.name,
        newVersion: nextVersionNumber,
        newDose: `${input.doseValue} ${input.doseUnit || latest?.doseUnit}`,
        previousDose: latest ? `${latest.doseValue} ${latest.doseUnit}` : null,
        changeReason: input.changeReason,
        actorType: input.actorType,
      },
    });

    return updated;
  }

  static async stopMedication(userId: string, medicationId: string, reason: string, conversationId?: string) {
    const med = await db.medication.findFirst({
      where: { id: medicationId, userId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });

    if (!med) throw new Error("Medication not found");

    const latest = med.versions[0];
    const nextVer = latest ? latest.versionNumber + 1 : 1;

    const stopped = await db.$transaction(async (tx) => {
      if (latest && !latest.endDate) {
        await tx.medicationVersion.update({
          where: { id: latest.id },
          data: { endDate: new Date() },
        });
      }

      await tx.medicationVersion.create({
        data: {
          medicationId: med.id,
          versionNumber: nextVer,
          doseValue: 0,
          doseUnit: latest?.doseUnit || "mg",
          frequency: "Descontinuado",
          changeReason: reason,
          endDate: new Date(),
          conversationId,
          informationOrigin: "USER_REPORTED",
        },
      });

      return tx.medication.update({
        where: { id: med.id },
        data: { isActive: false, updatedAt: new Date() },
      });
    });

    await logAudit({
      userId,
      action: "MEDICATION_STOPPED",
      entity: "MEDICATION",
      entityId: med.id,
      metadata: { name: med.name, reason },
    });

    return stopped;
  }
}
