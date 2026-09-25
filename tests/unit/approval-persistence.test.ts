import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/ai/executions/[id]/approve/route";
import { createSessionToken } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { MedicationService } from "../../src/lib/services/medication-service";
import { DietService } from "../../src/lib/services/diet-service";

describe("Agent Tool Execution & Approval Persistence", () => {
  // Preserve original methods for cleanup
  const origAuditCreate = db.auditLog.create;
  const origUserFindUnique = db.user.findUnique;
  const origExecFindFirst = db.aiToolExecution.findFirst;
  const origExecUpdate = db.aiToolExecution.update;
  const origMsgFindUnique = db.message.findUnique;
  const origMsgFindMany = db.message.findMany;
  const origMsgUpdate = db.message.update;
  const origTransaction = db.$transaction;
  const origMedCreate = MedicationService.create;
  const origDietFindUnique = db.dietPlan.findUnique;

  after(() => {
    db.auditLog.create = origAuditCreate;
    db.user.findUnique = origUserFindUnique;
    db.aiToolExecution.findFirst = origExecFindFirst;
    db.aiToolExecution.update = origExecUpdate;
    db.message.findUnique = origMsgFindUnique;
    db.message.findMany = origMsgFindMany;
    db.message.update = origMsgUpdate;
    db.$transaction = origTransaction;
    MedicationService.create = origMedCreate;
    db.dietPlan.findUnique = origDietFindUnique;
  });

  it("should approve execution, update AiToolExecution to EXECUTED, and synchronize Message.metadata.toolExecutions via transaction", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-101",
      userId: "user-test-persist",
      conversationId: "conv-101",
      messageId: "msg-101",
      toolCallId: "call_med_101",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: {
        name: "Semaglutida",
        generic_name: "semaglutide",
        dose_value: 0.5,
        dose_unit: "mg",
        frequency: "semanal",
        _proposalMeta: {
          proposedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    };

    let persistedMessage: any = {
      id: "msg-101",
      conversationId: "conv-101",
      senderType: "AI",
      content: "Sugiro iniciar Semaglutida 0.5mg.",
      metadata: {
        toolExecutions: [
          {
            toolCallId: "call_med_101",
            toolName: "healthvault_create_medication",
            output: {
              success: true,
              requires_approval: true,
              execution_id: "exec-101",
              message: "Esta ação requer confirmação manual.",
              proposal: { name: "Semaglutida", dose_value: 0.5, dose_unit: "mg" },
            },
          },
        ],
      },
    };

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.auditLog.create as any) = async () => ({ id: "audit-mock-id" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (MedicationService.create as any) = async () => ({ id: "med-new-1", name: "Semaglutida", currentVersion: 1 });

    // Mock Prisma $transaction
    (db.$transaction as any) = async (callback: any) => {
      const tx = {
        aiToolExecution: {
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async ({ data }: any) => {
            persistedMessage = { ...persistedMessage, ...data };
            return persistedMessage;
          },
        },
      };
      return await callback(tx);
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-101/approve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-101" } });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.status, "EXECUTED");

    // Verify AiToolExecution status in DB
    assert.strictEqual(persistedExecution.status, "EXECUTED");
    assert.strictEqual(persistedExecution.approvedBy, "clinician");
    assert.ok(persistedExecution.completedAt);

    // Verify Message.metadata.toolExecutions synchronization
    const syncedTool = persistedMessage.metadata.toolExecutions[0];
    assert.strictEqual(syncedTool.output.requires_approval, false);
    assert.strictEqual(syncedTool.output.resolvedAction, "approve");
    assert.strictEqual(syncedTool.output.success, true);
    assert.deepStrictEqual(syncedTool.output.data, {
      entity: "medication",
      id: "med-new-1",
      name: "Semaglutida",
      version: 1,
    });
  });

  it("should reject execution, update AiToolExecution to REJECTED, and preserve REJECTED on reload", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-102",
      userId: "user-test-persist",
      conversationId: "conv-102",
      messageId: "msg-102",
      toolCallId: "call_med_102",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: { name: "Aspirina", _proposalMeta: {} },
    };

    let persistedMessage: any = {
      id: "msg-102",
      conversationId: "conv-102",
      senderType: "AI",
      content: "Sugiro Aspirina.",
      metadata: {
        toolExecutions: [
          {
            toolCallId: "call_med_102",
            toolName: "healthvault_create_medication",
            output: {
              success: true,
              requires_approval: true,
              execution_id: "exec-102",
            },
          },
        ],
      },
    };

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (db.$transaction as any) = async (callback: any) => {
      const tx = {
        aiToolExecution: {
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async ({ data }: any) => {
            persistedMessage = { ...persistedMessage, ...data };
            return persistedMessage;
          },
        },
      };
      return await callback(tx);
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-102/approve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "reject" }),
    });

    const res = await POST(req, { params: { id: "exec-102" } });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, "REJECTED");
    assert.strictEqual(persistedExecution.status, "REJECTED");

    const syncedTool = persistedMessage.metadata.toolExecutions[0];
    assert.strictEqual(syncedTool.output.requires_approval, false);
    assert.strictEqual(syncedTool.output.resolvedAction, "reject");
  });

  it("should handle VERSION_CONFLICT: execution must NOT remain PENDING_APPROVAL and transition to FAILED", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-103",
      userId: "user-test-persist",
      conversationId: "conv-103",
      messageId: "msg-103",
      toolCallId: "call_diet_103",
      toolName: "healthvault_update_diet",
      status: "PENDING_APPROVAL",
      inputJson: {
        target_calories: 2200,
        _proposalMeta: {
          entityId: "diet-uuid-1",
          entityType: "diet",
          entityVersionAtProposal: 1, // Proposal was created when diet was v1
        },
      },
    };

    let persistedMessage: any = {
      id: "msg-103",
      conversationId: "conv-103",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          {
            toolCallId: "call_diet_103",
            toolName: "healthvault_update_diet",
            output: { requires_approval: true, execution_id: "exec-103" },
          },
        ],
      },
    };

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    // Current diet in DB is now v2 (concurrency conflict!)
    (db.dietPlan.findUnique as any) = async () => ({ id: "diet-uuid-1", currentVersion: 2 });

    (db.$transaction as any) = async (callback: any) => {
      const tx = {
        aiToolExecution: {
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async ({ data }: any) => {
            persistedMessage = { ...persistedMessage, ...data };
            return persistedMessage;
          },
        },
      };
      return await callback(tx);
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-103/approve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-103" } });
    const body = await res.json();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(body.code, "VERSION_CONFLICT");

    // CRITICAL: AiToolExecution must NOT remain PENDING_APPROVAL!
    assert.notStrictEqual(persistedExecution.status, "PENDING_APPROVAL");
    assert.strictEqual(persistedExecution.status, "FAILED");
    assert.strictEqual(persistedExecution.errorCode, "VERSION_CONFLICT");
    assert.ok(persistedExecution.completedAt);

    // Verify metadata was updated with conflict and did NOT become approved
    const toolInMsg = persistedMessage.metadata.toolExecutions[0];
    assert.notStrictEqual(toolInMsg.output.resolvedAction, "approve");
    assert.strictEqual(toolInMsg.output.resolvedAction, "conflict");
    assert.strictEqual(toolInMsg.output.errorCode, "VERSION_CONFLICT");
  });

  it("should rollback transaction if Message metadata update fails", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-rollback-1",
      userId: "user-test-persist",
      conversationId: "conv-rb",
      messageId: "msg-rb",
      toolCallId: "call_rb",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: {
        name: "Metformina",
        _proposalMeta: {
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    };

    let persistedMessage: any = {
      id: "msg-rb",
      conversationId: "conv-rb",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          { toolCallId: "call_rb", output: { requires_approval: true, execution_id: "exec-rollback-1" } },
        ],
      },
    };

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (MedicationService.create as any) = async () => ({ id: "med-rb", name: "Metformina", currentVersion: 1 });

    // Transaction mock with automatic rollback on error
    (db.$transaction as any) = async (callback: any) => {
      const snapshotExecution = { ...persistedExecution };
      const snapshotMessage = { ...persistedMessage };
      const tx = {
        aiToolExecution: {
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async () => {
            // Simulate sudden DB constraint violation / failure on Message update
            throw new Error("Simulated Message update failure");
          },
        },
      };

      try {
        return await callback(tx);
      } catch (err) {
        // Rollback state
        persistedExecution = snapshotExecution;
        persistedMessage = snapshotMessage;
        throw err;
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-rollback-1/approve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-rollback-1" } });
    assert.strictEqual(res.status, 500);

    // CRITICAL: AiToolExecution must have been rolled back to PENDING_APPROVAL!
    assert.strictEqual(persistedExecution.status, "PENDING_APPROVAL", "AiToolExecution must rollback to PENDING_APPROVAL on transaction failure");
  });

  it("should prevent duplicate execution and preserve idempotency when status is already EXECUTED", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    const executedRecord = {
      id: "exec-105",
      userId: "user-test-persist",
      conversationId: "conv-105",
      toolName: "healthvault_create_medication",
      status: "EXECUTED",
      outputJson: { entity: "medication", id: "med-1", version: 1 },
      inputJson: {},
    };

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => executedRecord;

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-105/approve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-105" } });
    const body = await res.json();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.code, "ALREADY_RESOLVED");
    assert.strictEqual(body.status, "EXECUTED");
  });
});
