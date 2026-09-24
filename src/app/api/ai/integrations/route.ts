import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { encryptApiKey, maskApiKey } from "@/lib/ai/crypto";
import { OmniRouteProvider, normalizeBaseUrl } from "@/lib/ai/provider/omniroute-provider";
import { logAudit } from "@/lib/audit";

const createIntegrationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  baseUrl: z.string().url("Valid URL required (e.g. http://localhost:20128/v1 or https://omniroute.example.com/v1)"),
  apiKey: z.string().min(1, "API Key is required"),
  requestTimeoutMs: z.number().int().positive().optional().default(120000),
  defaultModel: z.string().optional().default("demigod-flash"),
  defaultCombo: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const integrations = await db.aiIntegration.findMany({
    where: { userId: user!.userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { models: true } },
      models: {
        where: { isCombo: true },
        select: { id: true, externalId: true, displayName: true, isCombo: true },
      },
    },
  });

  const sanitized = integrations.map((it) => ({
    ...it,
    maskedApiKey: maskApiKey(it.encryptedApiKey),
    encryptedApiKey: undefined, // Never expose to client
  }));

  return NextResponse.json({ integrations: sanitized });
}

export async function POST(req: NextRequest) {
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
    const result = createIntegrationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const { name, baseUrl, apiKey, requestTimeoutMs, defaultModel, defaultCombo } = result.data;

    // SSRF guard: ensure scheme is http/https
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Only http and https protocols are allowed." }, { status: 400 });
    }

    const normalized = normalizeBaseUrl(baseUrl);
    const encryptedApiKey = encryptApiKey(apiKey);

    // Initial connection test
    const testResult = await OmniRouteProvider.testConnection(normalized.baseUrl, apiKey, 10000);

    const integration = await db.aiIntegration.create({
      data: {
        userId: user!.userId,
        name,
        baseUrl: normalized.baseUrl,
        encryptedApiKey,
        requestTimeoutMs,
        defaultModel,
        defaultCombo,
        connectionStatus: testResult.success ? "CONNECTED" : "ERROR",
        lastTestedAt: new Date(),
        lastSuccessAt: testResult.success ? new Date() : null,
        lastErrorAt: testResult.success ? null : new Date(),
        lastErrorMessage: testResult.success ? null : testResult.error,
      },
    });

    // If connection was successful, trigger immediate background sync of models
    if (testResult.success) {
      try {
        const models = await OmniRouteProvider.listModels(normalized.baseUrl, apiKey);
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
            },
            create: {
              integrationId: integration.id,
              externalId: m.id,
              displayName: m.displayName,
              ownedBy: m.ownedBy,
              isCombo: m.isCombo,
            },
          });
        }
        await db.aiIntegration.update({
          where: { id: integration.id },
          data: { modelsLastSyncedAt: new Date() },
        });
      } catch (syncErr) {
        console.warn("Initial models sync warning:", syncErr);
      }
    }

    await logAudit({
      userId: user!.userId,
      action: "AI_INTEGRATION_CREATED",
      entity: "AI_INTEGRATION",
      entityId: integration.id,
      metadata: { name: integration.name, baseUrl: integration.baseUrl, status: integration.connectionStatus },
    });

    return NextResponse.json({
      success: true,
      integration: {
        ...integration,
        maskedApiKey: maskApiKey(apiKey),
        encryptedApiKey: undefined,
      },
      testResult,
    });
  } catch (error: any) {
    console.error("Create AI Integration error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create integration" }, { status: 500 });
  }
}
