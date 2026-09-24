import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { ToolRegistry } from "@/lib/ai/tools/registry";
import { resolveReasoningPolicy } from "@/lib/ai/response/reasoning-policy";
import { resolveResearchPolicy as resolveWebResearchPolicy } from "@/lib/ai/research/research-policy";

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

  const activeProvider = (process.env.WEB_RESEARCH_PROVIDER || "searxng").trim().toLowerCase();
  const researchInfo = {
    activeProvider: activeProvider === "searxng" ? "SearXNG" : (activeProvider === "brave" ? "Brave Search" : "Not configured"),
    searxngUrl: process.env.SEARXNG_BASE_URL || "http://172.26.128.61:8888",
    hasBraveKey: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    lastResearch: latestResearchAudit
      ? {
          timestamp: latestResearchAudit.timestamp,
          status: (latestResearchAudit.metadata as any)?.status || "UNKNOWN",
          sourcesCount: (latestResearchAudit.metadata as any)?.sourcesCount || 0,
          model: (latestResearchAudit.metadata as any)?.model,
          provider: (latestResearchAudit.metadata as any)?.provider,
        }
      : null,
  };

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
