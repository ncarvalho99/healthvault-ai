import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/lib/ai/crypto";
import { OmniRouteProvider } from "@/lib/ai/provider/omniroute-provider";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  });

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 });
  }

  const plainApiKey = decryptApiKey(integration.encryptedApiKey);
  const testResult = await OmniRouteProvider.testConnection(
    integration.baseUrl,
    plainApiKey,
    integration.requestTimeoutMs
  );

  // Update status in DB
  await db.aiIntegration.update({
    where: { id: integration.id },
    data: {
      connectionStatus: testResult.success ? "CONNECTED" : "ERROR",
      lastTestedAt: new Date(),
      lastSuccessAt: testResult.success ? new Date() : integration.lastSuccessAt,
      lastErrorAt: testResult.success ? null : new Date(),
      lastErrorMessage: testResult.success ? null : testResult.error,
    },
  });

  await logAudit({
    userId: user!.userId,
    action: "AI_INTEGRATION_TESTED",
    entity: "AI_INTEGRATION",
    entityId: integration.id,
    metadata: { success: testResult.success, latencyMs: testResult.latencyMs, error: testResult.error },
  });

  return NextResponse.json({ testResult });
}
