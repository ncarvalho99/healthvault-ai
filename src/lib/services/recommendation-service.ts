import { db } from "../db";
import { logAudit } from "../audit";
import { RecommendationStatus, SourceType, ActorType } from "@prisma/client";

export interface CreateRecommendationInput {
  title: string;
  conversationId?: string;
  status?: RecommendationStatus;
  sourceType?: SourceType;
  sourceName?: string;
  aiModel?: string;
  notes?: string;
  summarySnapshot?: Record<string, any>;
  changeReason?: string;
  actorType?: ActorType;
  actorName?: string;
  informationOrigin?: string;
}

export interface UpdateRecommendationInput {
  recommendationId: string;
  title?: string;
  status?: RecommendationStatus;
  notes?: string;
  summarySnapshot: Record<string, any>;
  changeReason: string;
  conversationId?: string;
  actorType?: ActorType;
  actorName?: string;
  informationOrigin?: string;
}

export class RecommendationService {
  static async getLatest(userId: string, conversationId?: string) {
    return db.recommendation.findFirst({
      where: {
        userId,
        ...(conversationId ? { conversationId } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
        medications: {
          where: { isActive: true },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
            },
          },
        },
      },
    });
  }

  static async list(userId: string) {
    return db.recommendation.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
        medications: {
          where: { isActive: true },
          include: {
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
            },
          },
        },
      },
    });
  }

  static async create(userId: string, input: CreateRecommendationInput) {
    const status = input.status || RecommendationStatus.AI_SUGGESTION;
    const sourceType = input.sourceType || SourceType.AI_AGENT;

    const recommendation = await db.$transaction(async (tx) => {
      const rec = await tx.recommendation.create({
        data: {
          userId,
          conversationId: input.conversationId,
          title: input.title,
          status,
          sourceType,
          sourceName: input.sourceName,
          aiModel: input.aiModel,
          notes: input.notes,
          currentVersion: 1,
        },
      });

      await tx.recommendationVersion.create({
        data: {
          recommendationId: rec.id,
          versionNumber: 1,
          status,
          summarySnapshot: input.summarySnapshot || {},
          changeReason: input.changeReason || "Protocolo inicial",
          conversationId: input.conversationId,
          actorType: input.actorType || ActorType.AI,
          actorName: input.actorName || input.sourceName,
          informationOrigin: input.informationOrigin || "AI_SUGGESTED",
        },
      });

      return rec;
    });

    await logAudit({
      userId,
      action: "RECOMMENDATION_CREATED",
      entity: "RECOMMENDATION",
      entityId: recommendation.id,
      metadata: {
        title: recommendation.title,
        status,
        version: 1,
        sourceType,
      },
    });

    return recommendation;
  }

  static async update(userId: string, input: UpdateRecommendationInput) {
    const existing = await db.recommendation.findFirst({
      where: { id: input.recommendationId, userId },
    });

    if (!existing) {
      throw new Error(`Recommendation not found for id ${input.recommendationId}`);
    }

    const nextVersionNumber = existing.currentVersion + 1;
    const finalStatus = input.status || existing.status;

    const updated = await db.$transaction(async (tx) => {
      await tx.recommendationVersion.create({
        data: {
          recommendationId: existing.id,
          versionNumber: nextVersionNumber,
          status: finalStatus,
          summarySnapshot: input.summarySnapshot,
          changeReason: input.changeReason,
          conversationId: input.conversationId || existing.conversationId,
          actorType: input.actorType || ActorType.AI,
          actorName: input.actorName,
          informationOrigin: input.informationOrigin || "AI_SUGGESTED",
        },
      });

      return tx.recommendation.update({
        where: { id: existing.id },
        data: {
          title: input.title || existing.title,
          status: finalStatus,
          notes: input.notes !== undefined ? input.notes : existing.notes,
          currentVersion: nextVersionNumber,
          updatedAt: new Date(),
        },
      });
    });

    await logAudit({
      userId,
      action: "RECOMMENDATION_VERSION_CREATED",
      entity: "RECOMMENDATION",
      entityId: existing.id,
      metadata: {
        title: updated.title,
        newVersion: nextVersionNumber,
        reason: input.changeReason,
        actorType: input.actorType,
      },
    });

    return updated;
  }
}
