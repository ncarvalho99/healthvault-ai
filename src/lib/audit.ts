import { db } from "./db";
import { Prisma } from "@prisma/client";

export interface LogAuditParams {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  try {
    // Sanitization: Never log passwords, tokens, full keys, or cookie contents
    const sanitizedMetadata: Record<string, unknown> = {};
    if (params.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes("password") ||
          lowerKey.includes("token") ||
          lowerKey.includes("secret") ||
          lowerKey.includes("cookie") ||
          lowerKey.includes("auth")
        ) {
          sanitizedMetadata[key] = "[REDACTED]";
        } else {
          sanitizedMetadata[key] = value;
        }
      }
    }

    await db.auditLog.create({
      data: {
        userId: params.userId || null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        metadata: sanitizedMetadata as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("Audit logging failed:", error);
  }
}
