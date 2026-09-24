import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { ToolRegistry } from "@/lib/ai/tools/registry";

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

  // 4. Integrations & Models status
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
    integrations,
  });
}
