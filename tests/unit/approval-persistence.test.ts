import { describe, it, after } from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/ai/executions/[id]/approve/route";
import { createSessionToken } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { MedicationService } from "../../src/lib/services/medication-service";
import { DietService } from "../../src/lib/services/diet-service";

describe("Agent Tool Execution & Approval Persistence", () => {
  // Silence auditLog prisma calls in unit test environment
  const origAuditCreate = db.auditLog.create;
  (db.auditLog.create as any) = async () => ({ id: "audit-mock-id" });

  after(() => {
    db.auditLog.create = origAuditCreate;
  });
  it("should approve execution, update AiToolExecution to EXECUTED, and synchronize Message.metadata.toolExecutions", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    // Mock in-memory state for AiToolExecution and Message
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

    // Mock Prisma methods on db
    const origUserFindUnique = db.user.findUnique;
    const origExecFindFirst = db.aiToolExecution.findFirst;
    const origExecUpdate = db.aiToolExecution.update;
    const origMsgFindUnique = db.message.findUnique;
    const origMsgUpdate = db.message.update;
    const origMedCreate = MedicationService.create;

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (db.aiToolExecution.update as any) = async ({ data }: any) => {
      persistedExecution = { ...persistedExecution, ...data };
      return persistedExecution;
    };
    (db.message.findUnique as any) = async () => persistedMessage;
    (db.message.update as any) = async ({ data }: any) => {
      persistedMessage = { ...persistedMessage, ...data };
      return persistedMessage;
    };
    (MedicationService.create as any) = async () => ({ id: "med-new-1", name: "Semaglutida", currentVersion: 1 });

    try {
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

      // Simulate RELOAD: loading the message again from DB
      const reloadedMessage = await db.message.findUnique({ where: { id: "msg-101" } });
      const reloadedTool = (reloadedMessage as any).metadata.toolExecutions[0];
      assert.strictEqual(reloadedTool.output.requires_approval, false);
      assert.strictEqual(reloadedTool.output.resolvedAction, "approve");
    } finally {
      db.user.findUnique = origUserFindUnique;
      db.aiToolExecution.findFirst = origExecFindFirst;
      db.aiToolExecution.update = origExecUpdate;
      db.message.findUnique = origMsgFindUnique;
      db.message.update = origMsgUpdate;
      MedicationService.create = origMedCreate;
    }
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

    const origUserFindUnique = db.user.findUnique;
    const origExecFindFirst = db.aiToolExecution.findFirst;
    const origExecUpdate = db.aiToolExecution.update;
    const origMsgFindUnique = db.message.findUnique;
    const origMsgUpdate = db.message.update;

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (db.aiToolExecution.update as any) = async ({ data }: any) => {
      persistedExecution = { ...persistedExecution, ...data };
      return persistedExecution;
    };
    (db.message.findUnique as any) = async () => persistedMessage;
    (db.message.update as any) = async ({ data }: any) => {
      persistedMessage = { ...persistedMessage, ...data };
      return persistedMessage;
    };

    try {
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

      // Reload check
      const reloadedMessage = await db.message.findUnique({ where: { id: "msg-102" } });
      const reloadedTool = (reloadedMessage as any).metadata.toolExecutions[0];
      assert.strictEqual(reloadedTool.output.requires_approval, false);
      assert.strictEqual(reloadedTool.output.resolvedAction, "reject");
    } finally {
      db.user.findUnique = origUserFindUnique;
      db.aiToolExecution.findFirst = origExecFindFirst;
      db.aiToolExecution.update = origExecUpdate;
      db.message.findUnique = origMsgFindUnique;
      db.message.update = origMsgUpdate;
    }
  });

  it("should reject with 409 VERSION_CONFLICT and NOT mark metadata as approved", async () => {
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

    const origUserFindUnique = db.user.findUnique;
    const origExecFindFirst = db.aiToolExecution.findFirst;
    const origMsgFindUnique = db.message.findUnique;
    const origMsgUpdate = db.message.update;
    const origDietFindUnique = db.dietPlan.findUnique;

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (db.message.findUnique as any) = async () => persistedMessage;
    (db.message.update as any) = async ({ data }: any) => {
      persistedMessage = { ...persistedMessage, ...data };
      return persistedMessage;
    };
    // Current diet in DB is now v2 (concurrency conflict!)
    (db.dietPlan.findUnique as any) = async () => ({ id: "diet-uuid-1", currentVersion: 2 });

    try {
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

      // Verify metadata did NOT turn into approved
      const toolInMsg = persistedMessage.metadata.toolExecutions[0];
      assert.notStrictEqual(toolInMsg.output.resolvedAction, "approve");
      assert.strictEqual(toolInMsg.output.resolvedAction, "conflict");
      assert.strictEqual(toolInMsg.output.errorCode, "VERSION_CONFLICT");
    } finally {
      db.user.findUnique = origUserFindUnique;
      db.aiToolExecution.findFirst = origExecFindFirst;
      db.message.findUnique = origMsgFindUnique;
      db.message.update = origMsgUpdate;
      db.dietPlan.findUnique = origDietFindUnique;
    }
  });

  it("should reject with 410 PROPOSAL_EXPIRED and NOT mark metadata as approved", async () => {
    const token = await createSessionToken({ userId: "user-test-persist", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-104",
      userId: "user-test-persist",
      conversationId: "conv-104",
      messageId: "msg-104",
      toolCallId: "call_med_104",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      inputJson: {
        name: "Metformina",
        _proposalMeta: {
          expiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
        },
      },
    };

    let persistedMessage: any = {
      id: "msg-104",
      conversationId: "conv-104",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          {
            toolCallId: "call_med_104",
            toolName: "healthvault_create_medication",
            output: { requires_approval: true, execution_id: "exec-104" },
          },
        ],
      },
    };

    const origUserFindUnique = db.user.findUnique;
    const origExecFindFirst = db.aiToolExecution.findFirst;
    const origExecUpdate = db.aiToolExecution.update;
    const origMsgFindUnique = db.message.findUnique;
    const origMsgUpdate = db.message.update;

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;
    (db.aiToolExecution.update as any) = async ({ data }: any) => {
      persistedExecution = { ...persistedExecution, ...data };
      return persistedExecution;
    };
    (db.message.findUnique as any) = async () => persistedMessage;
    (db.message.update as any) = async ({ data }: any) => {
      persistedMessage = { ...persistedMessage, ...data };
      return persistedMessage;
    };

    try {
      const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-104/approve", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "approve" }),
      });

      const res = await POST(req, { params: { id: "exec-104" } });
      const body = await res.json();

      assert.strictEqual(res.status, 410);
      assert.strictEqual(body.code, "PROPOSAL_EXPIRED");

      // Verify metadata did NOT become approved
      const toolInMsg = persistedMessage.metadata.toolExecutions[0];
      assert.notStrictEqual(toolInMsg.output.resolvedAction, "approve");
      assert.strictEqual(toolInMsg.output.resolvedAction, "expired");
      assert.strictEqual(toolInMsg.output.errorCode, "PROPOSAL_EXPIRED");
    } finally {
      db.user.findUnique = origUserFindUnique;
      db.aiToolExecution.findFirst = origExecFindFirst;
      db.aiToolExecution.update = origExecUpdate;
      db.message.findUnique = origMsgFindUnique;
      db.message.update = origMsgUpdate;
    }
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

    const origUserFindUnique = db.user.findUnique;
    const origExecFindFirst = db.aiToolExecution.findFirst;

    (db.user.findUnique as any) = async () => ({ id: "user-test-persist", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => executedRecord;

    try {
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
    } finally {
      db.user.findUnique = origUserFindUnique;
      db.aiToolExecution.findFirst = origExecFindFirst;
    }
  });
});
