import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Server-side ownership checks for every foreign key supplied by the client.
 *
 * A UUID is an identifier, never an authorization token: before a client-supplied
 * conversationId / medicationId / recommendationId is persisted as a relation, it must
 * be proven to belong to the authenticated user. Otherwise user A could attach records
 * to user B's conversation (cross-tenant injection) or read B's data back through
 * relation includes on A's own GET endpoints.
 */

export type OwnedEntity = "conversation" | "medication" | "recommendation";

export class OwnershipError extends Error {
  constructor(public readonly entity: OwnedEntity, public readonly entityId: string) {
    super(`FOREIGN_KEY_NOT_OWNED: ${entity} ${entityId} not found for this user`);
    this.name = "OwnershipError";
  }
}

type OwnershipClient = {
  conversation: { findFirst(args: any): Promise<unknown> };
  medication: { findFirst(args: any): Promise<unknown> };
  recommendation: { findFirst(args: any): Promise<unknown> };
};

async function assertOwned(
  client: OwnershipClient,
  entity: OwnedEntity,
  userId: string,
  id: string | null | undefined
) {
  if (id === undefined || id === null) return;
  const found = await (client[entity] as any).findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!found) throw new OwnershipError(entity, id);
}

export function assertOwnedConversation(userId: string, id?: string | null, client: OwnershipClient = db) {
  return assertOwned(client, "conversation", userId, id);
}

export function assertOwnedMedication(userId: string, id?: string | null, client: OwnershipClient = db) {
  return assertOwned(client, "medication", userId, id);
}

export function assertOwnedRecommendation(userId: string, id?: string | null, client: OwnershipClient = db) {
  return assertOwned(client, "recommendation", userId, id);
}

/** Validates a set of client-supplied FKs in one call. Undefined/null entries are skipped. */
export async function assertOwnedRefs(
  userId: string,
  refs: { conversationId?: string | null; medicationId?: string | null; recommendationId?: string | null },
  client: OwnershipClient = db
) {
  await assertOwned(client, "conversation", userId, refs.conversationId);
  await assertOwned(client, "medication", userId, refs.medicationId);
  await assertOwned(client, "recommendation", userId, refs.recommendationId);
}

/**
 * Maps an OwnershipError to a 404 (same response as a non-existent id, so the
 * endpoint does not become an oracle for other users' UUIDs). Returns null otherwise.
 */
export function ownershipErrorResponse(error: unknown) {
  if (error instanceof OwnershipError) {
    return NextResponse.json(
      { error: "Related record not found", code: "FOREIGN_KEY_NOT_OWNED", field: `${error.entity}Id` },
      { status: 404 }
    );
  }
  return null;
}

/**
 * Defense in depth for reads: drops a related record from an include when it does not
 * belong to the requesting user (covers rows injected before write-side checks existed).
 */
export function stripForeignRelation<T extends Record<string, any>, K extends keyof T>(
  row: T,
  key: K,
  userId: string
): T {
  const related = row[key] as any;
  if (related && typeof related === "object" && "userId" in related) {
    if (related.userId !== userId) return { ...row, [key]: null };
    const { userId: _omit, ...rest } = related;
    return { ...row, [key]: rest };
  }
  return row;
}
