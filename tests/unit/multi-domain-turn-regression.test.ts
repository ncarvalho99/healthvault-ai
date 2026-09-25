import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolSelector } from "../../src/lib/ai/tools/selector";
import { ToolDispatcher } from "../../src/lib/ai/tools/dispatcher";
import {
  WriteIntentGuard,
  createTurnMutationState,
  recordTurnMutation,
} from "../../src/lib/ai/tools/write-intent-guard";
import { RecommendationService } from "../../src/lib/services/recommendation-service";
import { db } from "../../src/lib/db";

const SAVE_WEIGHT_AND_PLAN = "Sim. Atualize meu peso para 98 kg e salve o plano proposto no HealthVault.";
const PREVIOUS_ASSISTANT = "Você mencionou 98 kg — vault registra 85.7 kg. Quer que eu salve este plano e atualize seu peso?";

describe("Multi-domain turn regressions (commit 216cfbb residuals)", () => {
  // 1. Multi-domain ToolSelector
  describe("1. ToolSelector unions detected domains", () => {
    it("weight update + save plan exposes metric, diet and recommendation write tools", () => {
      const names = ToolSelector.selectTools({ userMessage: SAVE_WEIGHT_AND_PLAN, agentMode: "AGENT" }).map((t) => t.name);

      assert.ok(names.includes("healthvault_add_body_metric"), "metric write tool must be available");
      assert.ok(names.includes("healthvault_create_diet"), "diet create tool must be available");
      assert.ok(names.includes("healthvault_update_diet"), "diet update tool must be available");
      assert.ok(names.includes("healthvault_create_recommendation"), "recommendation create tool must be available");
      assert.ok(names.includes("healthvault_update_recommendation"), "recommendation update tool must be available");
    });

    it("union stays scoped: unrelated domains are not exposed", () => {
      const names = ToolSelector.selectTools({ userMessage: SAVE_WEIGHT_AND_PLAN, agentMode: "AGENT" }).map((t) => t.name);
      const all = ToolSelector.selectTools({ userMessage: "", agentMode: "AGENT" });

      assert.ok(names.length < all.length, "must not fall back to all tools");
      assert.strictEqual(names.includes("healthvault_add_lab_result"), false);
      assert.strictEqual(names.includes("healthvault_create_medication"), false);
    });
  });

  // 2. Baseline conflict resolved only by persisted state
  describe("2. Weight conflict resolution requires a persisted metric in the same turn", () => {
    const guardFor = (toolName: string, state = createTurnMutationState()) =>
      WriteIntentGuard.check({
        userMessage: SAVE_WEIGHT_AND_PLAN,
        previousAssistantMessage: PREVIOUS_ASSISTANT,
        toolName,
        toolAccess: "write",
        vaultWeightKg: 85.7,
        turnMutationState: state,
      });

    it("metric succeeds → diet/recommendation allowed and snapshot sees 98 kg", async () => {
      const state = createTurnMutationState();
      assert.strictEqual(guardFor("healthvault_create_recommendation", state).allowed, false, "blocked before metric");

      // Simulated vault: metric write persists 98 kg
      const vaultMetrics: Array<{ weightKg: number; bodyFatPct: number | null; date: Date }> = [
        { weightKg: 85.7, bodyFatPct: null, date: new Date(Date.now() - 86_400_000) },
      ];
      vaultMetrics.unshift({ weightKg: 98, bodyFatPct: null, date: new Date() });
      recordTurnMutation(state, "healthvault_add_body_metric", {
        success: true,
        data: { entity: "metric", id: "metric-98", weightKg: 98 },
      });

      assert.strictEqual(guardFor("healthvault_update_diet", state).allowed, true, "diet allowed after metric persisted");
      assert.strictEqual(guardFor("healthvault_create_recommendation", state).allowed, true, "recommendation allowed after metric persisted");

      const origTransaction = db.$transaction;
      const origAuditCreate = db.auditLog.create;
      const origDietFindFirst = db.dietPlan.findFirst;
      const origMedFindMany = db.medication.findMany;
      const origMetricFindFirst = db.bodyMetric.findFirst;
      let snapshot: any = null;

      (db.dietPlan.findFirst as any) = async () => null;
      (db.medication.findMany as any) = async () => [];
      (db.bodyMetric.findFirst as any) = async () => vaultMetrics[0];
      (db.auditLog.create as any) = async () => ({ id: "audit" });
      (db.$transaction as any) = async (cb: any) =>
        cb({
          recommendation: { create: async ({ data }: any) => ({ id: "rec-98", ...data }) },
          recommendationVersion: {
            create: async ({ data }: any) => {
              snapshot = data.summarySnapshot;
              return { id: "rec-98-v1", ...data };
            },
          },
        });

      try {
        await RecommendationService.create("user-98", { title: "Plano 98 kg" });
        assert.strictEqual(snapshot?.metrics?.latestWeightKg, 98, "snapshot must reflect the weight persisted this turn");
      } finally {
        db.$transaction = origTransaction;
        db.auditLog.create = origAuditCreate;
        db.dietPlan.findFirst = origDietFindFirst;
        db.medication.findMany = origMedFindMany;
        db.bodyMetric.findFirst = origMetricFindFirst;
      }
    });

    it("metric fails → diet/recommendation blocked through the dispatcher", async () => {
      const state = createTurnMutationState();
      recordTurnMutation(state, "healthvault_add_body_metric", {
        success: false,
        error: { code: "HANDLER_ERROR", message: "db down" },
      } as any);
      assert.strictEqual(state.weightUpdatedThisTurn, false);

      const origAuditCreate = db.auditLog.create;
      (db.auditLog.create as any) = async () => ({ id: "audit" });
      try {
        for (const toolName of ["healthvault_update_diet", "healthvault_create_recommendation"]) {
          const result = await ToolDispatcher.execute({
            userId: "user-98",
            conversationId: "conv-98",
            integrationId: "int-98",
            toolCallId: `call-${toolName}`,
            toolName,
            rawArguments: "{}",
            agentMode: "AGENT",
            userMessage: SAVE_WEIGHT_AND_PLAN,
            previousAssistantMessage: PREVIOUS_ASSISTANT,
            vaultWeightKg: 85.7,
            turnMutationState: state,
          });
          assert.strictEqual(result.success, false, `${toolName} must be blocked`);
          assert.strictEqual(result.error?.code, "BASELINE_CONFLICT");
        }
      } finally {
        db.auditLog.create = origAuditCreate;
      }
    });

    it("metric pending manual approval does not count as persisted", () => {
      const state = createTurnMutationState();
      recordTurnMutation(state, "healthvault_add_body_metric", {
        success: true,
        requires_approval: true,
        data: { weightKg: 98 },
      });
      assert.strictEqual(state.weightUpdatedThisTurn, false);
      assert.strictEqual(guardFor("healthvault_update_diet", state).allowed, false);
    });

    it("metric persisted with a different weight does not resolve the conflict", () => {
      const state = createTurnMutationState();
      recordTurnMutation(state, "healthvault_add_body_metric", { success: true, data: { weightKg: 90 } });
      assert.strictEqual(guardFor("healthvault_update_diet", state).allowed, false);
    });
  });

  // 3. Single audit owner for recommendations
  describe("3. Recommendation audits are emitted exactly once", () => {
    const withMockedDb = async (fn: (actions: string[]) => Promise<void>) => {
      const origTransaction = db.$transaction;
      const origAuditCreate = db.auditLog.create;
      const origDietFindFirst = db.dietPlan.findFirst;
      const origMedFindMany = db.medication.findMany;
      const origMetricFindFirst = db.bodyMetric.findFirst;
      const origRecFindFirst = db.recommendation.findFirst;
      const actions: string[] = [];

      (db.dietPlan.findFirst as any) = async () => null;
      (db.medication.findMany as any) = async () => [];
      (db.bodyMetric.findFirst as any) = async () => null;
      (db.auditLog.create as any) = async ({ data }: any) => {
        actions.push(data.action);
        return { id: `audit-${actions.length}` };
      };
      (db.recommendation.findFirst as any) = async () => ({
        id: "rec-a",
        userId: "user-a",
        title: "Plano",
        status: "AI_SUGGESTION",
        notes: null,
        currentVersion: 1,
        conversationId: null,
      });
      (db.$transaction as any) = async (cb: any) =>
        cb({
          recommendation: {
            create: async ({ data }: any) => ({ id: "rec-a", ...data }),
            update: async ({ data }: any) => ({ id: "rec-a", title: "Plano", ...data }),
          },
          recommendationVersion: { create: async ({ data }: any) => ({ id: "ver", ...data }) },
        });

      try {
        await fn(actions);
      } finally {
        db.$transaction = origTransaction;
        db.auditLog.create = origAuditCreate;
        db.dietPlan.findFirst = origDietFindFirst;
        db.medication.findMany = origMedFindMany;
        db.bodyMetric.findFirst = origMetricFindFirst;
        db.recommendation.findFirst = origRecFindFirst;
      }
    };

    it("one create → exactly one RECOMMENDATION_CREATED", async () => {
      await withMockedDb(async (actions) => {
        await RecommendationService.create("user-a", { title: "Plano", auditContext: { ipAddress: "10.0.0.1", userAgent: "test" } });
        assert.strictEqual(actions.filter((a) => a === "RECOMMENDATION_CREATED").length, 1);
      });
    });

    it("one update → exactly one RECOMMENDATION_VERSION_CREATED", async () => {
      await withMockedDb(async (actions) => {
        await RecommendationService.update("user-a", { recommendationId: "rec-a", changeReason: "Ajuste" });
        assert.strictEqual(actions.filter((a) => a === "RECOMMENDATION_VERSION_CREATED").length, 1);
      });
    });

    it("API routes delegate auditing to RecommendationService (no duplicate logAudit)", () => {
      const root = join(__dirname, "../../src/app/api/recommendations");
      const collection = readFileSync(join(root, "route.ts"), "utf-8");
      const item = readFileSync(join(root, "[id]", "route.ts"), "utf-8");

      assert.strictEqual(collection.includes('"RECOMMENDATION_CREATED"'), false, "POST route must not emit RECOMMENDATION_CREATED");
      assert.strictEqual(item.includes('"RECOMMENDATION_VERSION_CREATED"'), false, "PUT route must not emit RECOMMENDATION_VERSION_CREATED");
    });
  });
});
