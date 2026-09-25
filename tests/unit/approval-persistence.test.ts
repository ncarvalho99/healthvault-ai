import { describe, it, after } from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/ai/executions/[id]/approve/route";
import { createSessionToken } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { ToolRegistry } from "../../src/lib/ai/tools/registry";
import { MedicationService } from "../../src/lib/services/medication-service";
import { HealthService } from "../../src/lib/services/health-service";

describe("Agent Tool Execution & Approval Runtime Integrity", () => {
  const origAuditCreate = db.auditLog.create;
  const origUserFindUnique = db.user.findUnique;
  const origExecFindFirst = db.aiToolExecution.findFirst;
  const origExecUpdate = db.aiToolExecution.update;
  const origExecUpdateMany = db.aiToolExecution.updateMany;
  const origMsgFindUnique = db.message.findUnique;
  const origMsgFindMany = db.message.findMany;
  const origMsgUpdate = db.message.update;
  const origTransaction = db.$transaction;

  after(() => {
    db.auditLog.create = origAuditCreate;
    db.user.findUnique = origUserFindUnique;
    db.aiToolExecution.findFirst = origExecFindFirst;
    db.aiToolExecution.update = origExecUpdate;
    db.aiToolExecution.updateMany = origExecUpdateMany;
    db.message.findUnique = origMsgFindUnique;
    db.message.findMany = origMsgFindMany;
    db.message.update = origMsgUpdate;
    db.$transaction = origTransaction;
  });

  it("1. Parity Test: every write tool that ApprovalEngine can put in REVIEW_FIRST must have an approved executor", async () => {
    const allTools = ToolRegistry.getAll();
    const policyTools = allTools.filter((t) => t.access === "write" && t.requiresApproval !== false);

    assert.ok(policyTools.length >= 10, "Should have at least 10 policy-driven write tools");

    const expectedTools = [
      "healthvault_create_medication",
      "healthvault_update_medication",
      "healthvault_stop_medication",
      "healthvault_create_recommendation",
      "healthvault_update_recommendation",
      "healthvault_create_diet",
      "healthvault_update_diet",
      "healthvault_add_body_metric",
      "healthvault_add_symptom",
      "healthvault_add_lab_result",
    ];

    for (const tool of policyTools) {
      assert.ok(
        expectedTools.includes(tool.name),
        `Write tool '${tool.name}' capable of REVIEW_FIRST must be mapped in expected approval executors`
      );
    }
  });

  it("2. Lab approval: healthvault_add_lab_result canonical name approval creates LabTest and EXECUTED state", async () => {
    const token = await createSessionToken({ userId: "user-lab-test", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-lab-01",
      userId: "user-lab-test",
      conversationId: "conv-lab-01",
      messageId: "msg-lab-01",
      toolCallId: "call_lab_01",
      toolName: "healthvault_add_lab_result", // Canonical name matching ToolRegistry
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: {
        test_name: "Perfil Lipídico",
        marker_name: "Glicemia de Jejum",
        result_value: 92,
        unit: "mg/dL",
        reference_range_low: 70,
        reference_range_high: 99,
        _proposalMeta: {
          proposedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    };

    let persistedMessage: any = {
      id: "msg-lab-01",
      conversationId: "conv-lab-01",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          {
            toolCallId: "call_lab_01",
            toolName: "healthvault_add_lab_result",
            output: { requires_approval: true, execution_id: "exec-lab-01" },
          },
        ],
      },
    };

    let domainLabs: any[] = [];

    (db.user.findUnique as any) = async () => ({ id: "user-lab-test", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    (db.$transaction as any) = async (callback: any) => {
      const tx = {
        aiToolExecution: {
          updateMany: async ({ where, data }: any) => {
            if (persistedExecution.status === where.status) {
              persistedExecution = { ...persistedExecution, ...data };
              return { count: 1 };
            }
            return { count: 0 };
          },
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        labTest: {
          create: async ({ data }: any) => {
            const l = { id: "lab-record-01", ...data };
            domainLabs.push(l);
            return l;
          },
        },
        auditLog: {
          create: async () => ({ id: "audit-01" }),
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

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-lab-01/approve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-lab-01" } });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, "EXECUTED");
    assert.ok(body.result !== null, "outputResult must not be null");
    assert.strictEqual(body.result.entity, "lab");
    assert.strictEqual(body.result.markerName, "Glicemia de Jejum");

    // Real LabTest domain record created
    assert.strictEqual(domainLabs.length, 1);
    assert.strictEqual(domainLabs[0].markerName, "Glicemia de Jejum");
    assert.strictEqual(domainLabs[0].resultValue, 92);

    // AiToolExecution EXECUTED
    assert.strictEqual(persistedExecution.status, "EXECUTED");

    // Message metadata updated
    const tool = persistedMessage.metadata.toolExecutions[0];
    assert.strictEqual(tool.output.requires_approval, false);
    assert.strictEqual(tool.output.resolvedAction, "approve");
  });

  it("3. Stop medication approval: healthvault_stop_medication discontinues medication", async () => {
    const token = await createSessionToken({ userId: "user-stop-test", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-stop-01",
      userId: "user-stop-test",
      conversationId: "conv-stop-01",
      messageId: "msg-stop-01",
      toolCallId: "call_stop_01",
      toolName: "healthvault_stop_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: {
        medication_id: "med-active-99",
        reason: "Paciente atingiu meta terapêutica",
        _proposalMeta: {
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    };

    let persistedMessage: any = {
      id: "msg-stop-01",
      conversationId: "conv-stop-01",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          { toolCallId: "call_stop_01", output: { requires_approval: true, execution_id: "exec-stop-01" } },
        ],
      },
    };

    let medIsActive = true;
    let newVersionCreated = false;

    (db.user.findUnique as any) = async () => ({ id: "user-stop-test", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    (db.$transaction as any) = async (callback: any) => {
      const tx = {
        aiToolExecution: {
          updateMany: async ({ where, data }: any) => {
            if (persistedExecution.status === where.status) {
              persistedExecution = { ...persistedExecution, ...data };
              return { count: 1 };
            }
            return { count: 0 };
          },
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        medication: {
          findFirst: async () => ({
            id: "med-active-99",
            name: "Ozempic",
            isActive: true,
            versions: [{ versionNumber: 1, doseValue: 0.5, doseUnit: "mg" }],
          }),
          update: async ({ data }: any) => {
            medIsActive = data.isActive;
            return { id: "med-active-99", name: "Ozempic", isActive: data.isActive };
          },
        },
        medicationVersion: {
          update: async () => {},
          create: async ({ data }: any) => {
            newVersionCreated = true;
            return { id: "ver-stop-2", versionNumber: 2, ...data };
          },
        },
        auditLog: { create: async () => ({ id: "audit-stop" }) },
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

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-stop-01/approve", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-stop-01" } });
    const body = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, "EXECUTED");
    assert.strictEqual(body.result.status, "DISCONTINUED");
    assert.strictEqual(medIsActive, false, "Medication must be set to isActive = false");
    assert.strictEqual(newVersionCreated, true, "New discontinuation version must be created");
  });

  it("4. Unknown/Unsupported tool: throws UNSUPPORTED_APPROVAL_TOOL and rolls back", async () => {
    const token = await createSessionToken({ userId: "user-unsupported", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-weird-tool",
      userId: "user-unsupported",
      conversationId: "conv-weird",
      messageId: "msg-weird",
      toolCallId: "call_weird",
      toolName: "healthvault_unknown_future_mutation",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: { _proposalMeta: {} },
    };

    let persistedMessage: any = {
      id: "msg-weird",
      conversationId: "conv-weird",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          { toolCallId: "call_weird", output: { requires_approval: true, execution_id: "exec-weird-tool" } },
        ],
      },
    };

    (db.user.findUnique as any) = async () => ({ id: "user-unsupported", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    (db.$transaction as any) = async (callback: any) => {
      const snapshot = { ...persistedExecution };
      const tx = {
        aiToolExecution: {
          updateMany: async ({ where, data }: any) => {
            if (persistedExecution.status === where.status) {
              persistedExecution = { ...persistedExecution, ...data };
              return { count: 1 };
            }
            return { count: 0 };
          },
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async () => {},
        },
      };
      try {
        return await callback(tx);
      } catch (err) {
        persistedExecution = snapshot;
        throw err;
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-weird-tool/approve", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-weird-tool" } });
    assert.strictEqual(res.status, 500);

    // Rollback: status remains PENDING_APPROVAL and was NEVER committed as EXECUTED with null output
    assert.strictEqual(persistedExecution.status, "PENDING_APPROVAL");
  });

  it("5. Concurrency Compare-And-Set: two simultaneous approvals execute domain mutation exactly ONCE", async () => {
    const token = await createSessionToken({ userId: "user-race", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-race-01",
      userId: "user-race",
      conversationId: "conv-race",
      messageId: "msg-race",
      toolCallId: "call_race",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: {
        name: "Metformina",
        dose_value: 500,
        _proposalMeta: { expiresAt: new Date(Date.now() + 86400000).toISOString() },
      },
    };

    let persistedMessage: any = {
      id: "msg-race",
      conversationId: "conv-race",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          { toolCallId: "call_race", output: { requires_approval: true, execution_id: "exec-race-01" } },
        ],
      },
    };

    let domainMutationCallCount = 0;

    (db.user.findUnique as any) = async () => ({ id: "user-race", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    // Simulate real database with atomic compare-and-set
    (db.$transaction as any) = async (callback: any) => {
      const tx = {
        aiToolExecution: {
          updateMany: async ({ where, data }: any) => {
            // Atomic compare-and-set: check if status is still PENDING_APPROVAL
            if (persistedExecution.status === where.status) {
              persistedExecution = { ...persistedExecution, ...data };
              return { count: 1 };
            }
            return { count: 0 };
          },
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        medication: {
          create: async ({ data }: any) => {
            domainMutationCallCount++;
            return { id: "med-race-1", ...data };
          },
        },
        medicationVersion: {
          create: async ({ data }: any) => ({ id: "ver-1", versionNumber: 1, ...data }),
        },
        auditLog: { create: async () => ({ id: "audit-1" }) },
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

    const makeRequest = () =>
      new NextRequest("http://localhost:3000/api/ai/executions/exec-race-01/approve", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

    // Run both approval requests concurrently
    const [res1, res2] = await Promise.all([
      POST(makeRequest(), { params: { id: "exec-race-01" } }),
      POST(makeRequest(), { params: { id: "exec-race-01" } }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepStrictEqual(statuses, [200, 400], "One request must succeed (200) and the concurrent duplicate must fail (400)");

    // CRITICAL: Domain mutation must have been invoked exactly ONCE!
    assert.strictEqual(domainMutationCallCount, 1, "Domain mutation count must be strictly 1 under concurrency");
  });

  it("6. Transactional Audit Consistency: audit record is rolled back if Message metadata fails", async () => {
    const token = await createSessionToken({ userId: "user-audit-rb", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-audit-rb",
      userId: "user-audit-rb",
      conversationId: "conv-audit-rb",
      messageId: "msg-audit-rb",
      toolCallId: "call_audit_rb",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: {
        name: "Atorvastatina",
        _proposalMeta: { expiresAt: new Date(Date.now() + 86400000).toISOString() },
      },
    };

    let persistedMessage: any = {
      id: "msg-audit-rb",
      conversationId: "conv-audit-rb",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          { toolCallId: "call_audit_rb", output: { requires_approval: true, execution_id: "exec-audit-rb" } },
        ],
      },
    };

    let persistedAudits: any[] = [];
    let domainMeds: any[] = [];

    (db.user.findUnique as any) = async () => ({ id: "user-audit-rb", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    (db.$transaction as any) = async (callback: any) => {
      const snapExec = { ...persistedExecution };
      const snapAudits = [...persistedAudits];
      const snapMeds = [...domainMeds];
      const snapMsg = JSON.parse(JSON.stringify(persistedMessage));

      const tx = {
        aiToolExecution: {
          updateMany: async () => ({ count: 1 }),
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        medication: {
          create: async ({ data }: any) => {
            const m = { id: "med-rb", ...data };
            domainMeds.push(m);
            return m;
          },
        },
        medicationVersion: {
          create: async ({ data }: any) => ({ id: "v1", versionNumber: 1, ...data }),
        },
        auditLog: {
          create: async ({ data }: any) => {
            const a = { id: "audit-rb", ...data };
            persistedAudits.push(a);
            return a;
          },
        },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async () => {
            throw new Error("Message metadata DB failure");
          },
        },
      };

      try {
        return await callback(tx);
      } catch (err) {
        persistedExecution = snapExec;
        persistedAudits = snapAudits;
        domainMeds = snapMeds;
        persistedMessage = snapMsg;
        throw err;
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-audit-rb/approve", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-audit-rb" } });
    assert.strictEqual(res.status, 500);

    // CRITICAL: Both domain mutation AND audit record must rollback and disappear!
    assert.strictEqual(domainMeds.length, 0, "Domain mutation must rollback");
    assert.strictEqual(persistedAudits.length, 0, "Audit record must rollback with transaction");
    assert.strictEqual(persistedExecution.status, "PENDING_APPROVAL", "AiToolExecution must remain PENDING_APPROVAL");
  });

  it("7. Rollback if Message is not found", async () => {
    const token = await createSessionToken({ userId: "user-notfound", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-msg-nf",
      userId: "user-notfound",
      conversationId: "conv-nf",
      messageId: "msg-missing",
      toolCallId: "call_nf",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: { name: "Metformina", _proposalMeta: { expiresAt: new Date(Date.now() + 86400000).toISOString() } },
    };

    let domainMeds: any[] = [];

    (db.user.findUnique as any) = async () => ({ id: "user-notfound", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    (db.$transaction as any) = async (callback: any) => {
      const snapExec = { ...persistedExecution };
      const snapMeds = [...domainMeds];
      const tx = {
        aiToolExecution: {
          updateMany: async () => ({ count: 1 }),
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        medication: {
          create: async ({ data }: any) => {
            const m = { id: "m", ...data };
            domainMeds.push(m);
            return m;
          },
        },
        medicationVersion: { create: async () => ({ id: "v" }) },
        auditLog: { create: async () => ({ id: "a" }) },
        message: {
          findUnique: async () => null,
          findMany: async () => [],
          update: async () => {},
        },
      };
      try {
        return await callback(tx);
      } catch (err) {
        persistedExecution = snapExec;
        domainMeds = snapMeds;
        throw err;
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-msg-nf/approve", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-msg-nf" } });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(domainMeds.length, 0, "Domain mutation must rollback when Message is missing");
    assert.strictEqual(persistedExecution.status, "PENDING_APPROVAL");
  });

  it("8. Rollback if toolCallId is not found in message metadata", async () => {
    const token = await createSessionToken({ userId: "user-unmatched", username: "clinician", role: "USER" });

    let persistedExecution: any = {
      id: "exec-unmatched",
      userId: "user-unmatched",
      conversationId: "conv-unmatched",
      messageId: "msg-unmatched",
      toolCallId: "call_target_999",
      toolName: "healthvault_create_medication",
      status: "PENDING_APPROVAL",
      requiresApproval: true,
      inputJson: { name: "Metformina", _proposalMeta: { expiresAt: new Date(Date.now() + 86400000).toISOString() } },
    };

    let persistedMessage: any = {
      id: "msg-unmatched",
      conversationId: "conv-unmatched",
      senderType: "AI",
      metadata: {
        toolExecutions: [
          { toolCallId: "call_different_000", output: { requires_approval: true, execution_id: "other" } },
        ],
      },
    };

    let domainMeds: any[] = [];

    (db.user.findUnique as any) = async () => ({ id: "user-unmatched", username: "clinician", role: "USER" });
    (db.aiToolExecution.findFirst as any) = async () => persistedExecution;

    (db.$transaction as any) = async (callback: any) => {
      const snapExec = { ...persistedExecution };
      const snapMeds = [...domainMeds];
      const tx = {
        aiToolExecution: {
          updateMany: async () => ({ count: 1 }),
          update: async ({ data }: any) => {
            persistedExecution = { ...persistedExecution, ...data };
            return persistedExecution;
          },
        },
        medication: {
          create: async ({ data }: any) => {
            const m = { id: "m", ...data };
            domainMeds.push(m);
            return m;
          },
        },
        medicationVersion: { create: async () => ({ id: "v" }) },
        auditLog: { create: async () => ({ id: "a" }) },
        message: {
          findUnique: async () => persistedMessage,
          findMany: async () => [persistedMessage],
          update: async () => {},
        },
      };
      try {
        return await callback(tx);
      } catch (err) {
        persistedExecution = snapExec;
        domainMeds = snapMeds;
        throw err;
      }
    };

    const req = new NextRequest("http://localhost:3000/api/ai/executions/exec-unmatched/approve", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });

    const res = await POST(req, { params: { id: "exec-unmatched" } });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(domainMeds.length, 0, "Domain mutation must rollback when toolCallId does not match");
    assert.strictEqual(persistedExecution.status, "PENDING_APPROVAL");
  });
});
