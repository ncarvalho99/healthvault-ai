import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/ai/crypto";
import { OmniRouteProvider } from "@/lib/ai/provider/omniroute-provider";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const integration = await db.aiIntegration.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  try {
    const plainApiKey = decryptApiKey(integration.encryptedApiKey);
    const models = await OmniRouteProvider.listModels(
      integration.baseUrl,
      plainApiKey,
      integration.requestTimeoutMs
    );

    // First mark all models as not combo to clean up previously misclassified auto/ routes
    await db.aiModel.updateMany({
      where: { integrationId: integration.id },
      data: { isCombo: false },
    });

    // Upsert models into database
    for (const m of models) {
      await db.aiModel.upsert({
        where: {
          integrationId_externalId: {
            integrationId: integration.id,
            externalId: m.id,
          },
        },
        update: {
          displayName: m.displayName,
          ownedBy: m.ownedBy,
          isCombo: m.isCombo,
          lastSeenAt: new Date(),
          rawMetadata: m.rawMetadata,
        },
        create: {
          integrationId: integration.id,
          externalId: m.id,
          displayName: m.displayName,
          ownedBy: m.ownedBy,
          isCombo: m.isCombo,
          rawMetadata: m.rawMetadata,
        },
      });
    }

    await db.aiIntegration.update({
      where: { id: integration.id },
      data: {
        modelsLastSyncedAt: new Date(),
        connectionStatus: "CONNECTED",
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "AI_MODEL_SYNCED",
      entity: "AI_INTEGRATION",
      entityId: integration.id,
      metadata: { count: models.length },
    });

    const updatedModels = await db.aiModel.findMany({
      where: { integrationId: integration.id },
      orderBy: [{ isCombo: "desc" }, { displayName: "asc" }],
    });

    return NextResponse.json({
      success: true,
      count: models.length,
      models: updatedModels,
    });
  } catch (error: any) {
    console.error("Models sync error:", error);
    return NextResponse.json({ error: error?.message || "Failed to sync models" }, { status: 500 });
  }
}
