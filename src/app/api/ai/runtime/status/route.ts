import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { ToolRegistry } from "@/lib/ai/tools/registry";
import { resolveReasoningPolicy } from "@/lib/ai/response/reasoning-policy";
import { resolveResearchPolicy as resolveWebResearchPolicy } from "@/lib/ai/research/research-policy";
import { resolveResearchProviderPriority } from "@/lib/ai/research/provider-priority";
import { OmniRouteSearchProvider } from "@/lib/ai/research/providers/omniroute-search-provider";
import { SearXNGProvider } from "@/lib/ai/research/providers/searxng-provider";
import { decryptApiKey } from "@/lib/ai/crypto";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const userId = user!.userId;

  // 1. Tool executions stats
  const totalExecutions = await db.aiToolExecution.count({ where: { userId } });
  const pendingApprovals = await db.aiToolExecution.count({ where: { userId, status: "PENDING_APPROVAL" } });
  const executedCount = await db.aiToolExecution.count({ where: { userId, status: "EXECUTED" } });
  const failedCount = await db.aiToolExecution.count({ where: { userId, status: "FAILED" } });
  const rejectedCount = await db.aiToolExecution.count({ where: { userId, status: "REJECTED" } });

  // 2. Recent tool execution records (sanitized, limit 50)
  const executions = await db.aiToolExecution.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      conversation: { select: { id: true, title: true } },
    },
  });

  // 3. Registered tools in runtime
  const tools = ToolRegistry.getAll().map((t) => ({
    name: t.name,
    version: t.version,
    description: t.description,
    category: t.category,
    access: t.access,
    risk: t.risk,
    requiresApproval: t.requiresApproval,
  }));

  // 4. Latest research audit log
  const latestResearchAudit = await db.auditLog.findFirst({
    where: { userId, action: "AI_WEB_RESEARCH_EXECUTED" },
    orderBy: { timestamp: "desc" },
    select: {
      timestamp: true,
      metadata: true,
    },
  });

  // 5. Integrations & Models status with Reasoning and Web Research Policies
  const integrations = await db.aiIntegration.findMany({
    where: { userId },
    include: {
      _count: { select: { models: true } },
      models: {
        where: { isCombo: true },
        select: {
          id: true,
          externalId: true,
          displayName: true,
          supportsTools: true,
          supportsChat: true,
          supportsStreaming: true,
          lastSeenAt: true,
        },
      },
    },
  });

  // 6. Multi-provider Health Diagnostics (OmniRoute Search Gateway + SearXNG)
  let omnirouteHealth: {
    ok: boolean;
    status: string;
    latencyMs: number;
    error: string;
    availableSubProviders?: string[];
    subProviderProbes?: Record<string, any>;
  } = { ok: false, status: "DOWN", latencyMs: 0, error: "No integration" };
  const firstIntegration = integrations[0];
  if (firstIntegration) {
    try {
      const plainApiKey = decryptApiKey(firstIntegration.encryptedApiKey);
      const omniSearch = new OmniRouteSearchProvider({
        baseUrl: firstIntegration.baseUrl,
        apiKey: plainApiKey,
      });
      const h = await omniSearch.healthCheck();
      omnirouteHealth = {
        ok: h.ok,
        status: h.status || (h.ok ? "HEALTHY" : "DOWN"),
        latencyMs: h.latencyMs || 0,
        error: h.error || "",
        availableSubProviders: h.availableSubProviders || [],
        subProviderProbes: h.subProviderProbes || {},
      };
    } catch (err: any) {
      omnirouteHealth = { ok: false, status: "DOWN", latencyMs: 0, error: err.message };
    }
  }

  let searxngHealth = { ok: false, status: "DOWN", latencyMs: 0, error: "" };
  try {
    const searxng = new SearXNGProvider();
    const sh = await searxng.healthCheck();
    searxngHealth = {
      ok: sh.ok,
      status: sh.status || (sh.ok ? "HEALTHY" : "DOWN"),
      latencyMs: sh.latencyMs || 0,
      error: sh.error || "",
    };
  } catch (err: any) {
    searxngHealth = { ok: false, status: "DOWN", latencyMs: 0, error: err.message };
  }

  const priorityInfo = resolveResearchProviderPriority();
  const meta = (latestResearchAudit?.metadata as any) || {};
  const researchInfo = {
    gateway: "omniroute",
    priority: priorityInfo.fullPriority,
    omnirouteSubProviders: priorityInfo.omnirouteSubProviders,
    directFallbacks: priorityInfo.directFallbacks,
    providers: {
      omniroute: omnirouteHealth,
      searxng: searxngHealth,
    },
    lastResearch: latestResearchAudit
      ? {
          timestamp: latestResearchAudit.timestamp,
          status: meta.status || "UNKNOWN",
          reasonCode: meta.reasonCode,
          sourcesCount: meta.sourcesCount || 0,
          rawResultCount: meta.rawResultCount ?? meta.sourcesCount ?? 0,
          model: meta.model,
          provider: meta.provider,
          providersAttempted: meta.providersAttempted || [meta.provider].filter(Boolean),
        }
      : null,
  };

  const enrichedIntegrations = integrations.map((int) => ({
    ...int,
    models: int.models.map((m) => ({
      ...m,
      reasoningPolicy: resolveReasoningPolicy(m.externalId),
      webResearchPolicy: resolveWebResearchPolicy(m.externalId),
    })),
  }));

  return NextResponse.json({
    stats: {
      totalExecutions,
      pendingApprovals,
      executedCount,
      failedCount,
      rejectedCount,
    },
    toolsCount: tools.length,
    tools,
    executions,
    integrations: enrichedIntegrations,
    researchInfo,
  });
}
