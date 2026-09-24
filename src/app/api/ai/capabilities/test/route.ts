import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/ai/crypto";
import { OmniRouteProvider } from "@/lib/ai/provider/omniroute-provider";
import { logAudit } from "@/lib/audit";

const testCapabilitySchema = z.object({
  integrationId: z.string().uuid(),
  modelExternalId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  try {
    const body = await req.json();
    const result = testCapabilitySchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.format() }, { status: 400 });
    }

    const { integrationId, modelExternalId } = result.data;

    const integration = await db.aiIntegration.findFirst({
      where: { id: integrationId, userId: user!.userId },
    });

    if (!integration) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const plainApiKey = decryptApiKey(integration.encryptedApiKey);

    await logAudit({
      userId: user!.userId,
      action: "AI_CAPABILITY_TEST_STARTED",
      entity: "AI_MODEL",
      metadata: { model: modelExternalId },
    });

    // Run handshake tool test
    const testResult = await OmniRouteProvider.testToolCalling(
      integration.baseUrl,
      plainApiKey,
      modelExternalId,
      25000
    );

    // Update capability in database
    await db.aiModel.updateMany({
      where: { integrationId, externalId: modelExternalId },
      data: {
        supportsTools: testResult.supportsTools,
        lastSeenAt: new Date(),
      },
    });

    await logAudit({
      userId: user!.userId,
      action: testResult.supportsTools ? "AI_CAPABILITY_TEST_SUCCEEDED" : "AI_CAPABILITY_TEST_FAILED",
      entity: "AI_MODEL",
      metadata: { model: modelExternalId, supportsTools: testResult.supportsTools, latencyMs: testResult.latencyMs },
    });

    return NextResponse.json({
      success: true,
      model: modelExternalId,
      supportsTools: testResult.supportsTools,
      latencyMs: testResult.latencyMs,
      error: testResult.error,
    });
  } catch (error: any) {
    console.error("Capability test error:", error);
    return NextResponse.json({ error: error?.message || "Failed to test model capability" }, { status: 500 });
  }
}
