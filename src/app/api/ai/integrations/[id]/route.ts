import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { encryptApiKey, maskApiKey } from "@/lib/ai/crypto";
import { OmniRouteProvider, normalizeBaseUrl } from "@/lib/ai/provider/omniroute-provider";
import { logAudit } from "@/lib/audit";

const updateIntegrationSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  defaultModel: z.string().optional(),
  defaultCombo: z.string().optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const integration = await db.aiIntegration.findFirst({
    where: { id: params.id, userId: user!.userId },
    include: {
      models: {
        orderBy: [{ isCombo: "desc" }, { displayName: "asc" }],
      },
    },
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  return NextResponse.json({
    integration: {
      ...integration,
      maskedApiKey: maskApiKey(integration.encryptedApiKey),
      encryptedApiKey: undefined,
    },
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const result = updateIntegrationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const existing = await db.aiIntegration.findFirst({
      where: { id: params.id, userId: user!.userId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const updateData: any = { ...result.data };

    if (result.data.baseUrl) {
      const normalized = normalizeBaseUrl(result.data.baseUrl);
      updateData.baseUrl = normalized.baseUrl;
    }

    if (result.data.apiKey && result.data.apiKey.trim().length > 0) {
      updateData.encryptedApiKey = encryptApiKey(result.data.apiKey.trim());
      delete updateData.apiKey;
    }

    const updated = await db.aiIntegration.update({
      where: { id: params.id },
      data: updateData,
    });

    await logAudit({
      userId: user!.userId,
      action: "AI_INTEGRATION_UPDATED",
      entity: "AI_INTEGRATION",
      entityId: params.id,
      metadata: { name: updated.name, defaultModel: updated.defaultModel, defaultCombo: updated.defaultCombo },
    });

    return NextResponse.json({
      success: true,
      integration: {
        ...updated,
        maskedApiKey: maskApiKey(updated.encryptedApiKey),
        encryptedApiKey: undefined,
      },
    });
  } catch (error: any) {
    console.error("Update integration error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update integration" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const existing = await db.aiIntegration.findFirst({
    where: { id: params.id, userId: user!.userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  // Delete integration (cascades to models)
  await db.aiIntegration.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "AI_INTEGRATION_DELETED",
    entity: "AI_INTEGRATION",
    entityId: params.id,
    metadata: { name: existing.name, baseUrl: existing.baseUrl },
  });

  return NextResponse.json({ success: true, message: "Integração removida com sucesso" });
}
