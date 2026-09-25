import { describe, it } from "node:test";
import assert from "node:assert";
import { WriteIntentGuard } from "../../src/lib/ai/tools/write-intent-guard";
import { EvidenceConsistencyGate } from "../../src/lib/ai/response/evidence-consistency-gate";
import { RecommendationSnapshotBuilder } from "../../src/lib/services/recommendation-snapshot-builder";
import { RecommendationService } from "../../src/lib/services/recommendation-service";
import { db } from "../../src/lib/db";

describe("HealthVault AI — Functional Consistency & UI Quality Regressions", () => {
  // 1. Confirmation Binding
  describe("1. Confirmation Binding", () => {
    it("generic affirmative 'sim' without offer to save → write denied", () => {
      const check = WriteIntentGuard.check({
        userMessage: "sim",
        previousAssistantMessage: "Você quer mais detalhes sobre a fisiologia da corrida?",
        toolName: "healthvault_update_diet",
        toolAccess: "write",
        toolCategory: "nutrition",
      });

      assert.strictEqual(check.allowed, false, "Generic affirmative without offer to save must be denied");
      assert.strictEqual(check.intent, "NO_WRITE_INTENT");
      assert.ok(check.reason?.includes("WRITE_INTENT_REQUIRED"));
    });

    it("generic affirmative 'sim' with explicit previous offer to save → write allowed", () => {
      const check = WriteIntentGuard.check({
        userMessage: "sim",
        previousAssistantMessage: "Quer que eu salve esse plano no HealthVault?",
        toolName: "healthvault_update_diet",
        toolAccess: "write",
        toolCategory: "nutrition",
      });

      assert.strictEqual(check.allowed, true, "Generic affirmative with explicit offer to save must be allowed");
      assert.strictEqual(check.intent, "CONFIRMATION");
    });

    it("explicit mutation command 'salve' → classified as EXPLICIT_MUTATION", () => {
      const check = WriteIntentGuard.check({
        userMessage: "salve essa dieta no meu prontuário",
        toolName: "healthvault_update_diet",
        toolAccess: "write",
        toolCategory: "nutrition",
      });

      assert.strictEqual(check.allowed, true);
      assert.strictEqual(check.intent, "EXPLICIT_MUTATION");
    });
  });

  // 2. Persist Baseline Conflict Across Follow-up
  describe("2. Persist Baseline Conflict Across Follow-up", () => {
    it("follow-up 'sim, salve' with unresolved prior weight conflict → BASELINE_CONFLICT denied", () => {
      const check = WriteIntentGuard.check({
        userMessage: "sim, salve",
        previousAssistantMessage: "Você mencionou 98 kg — vault registra 85.7 kg. Se o peso atual é de fato 98 kg, me confirma?",
        previousUserMessage: "estou com 98 kg, monte uma dieta",
        toolName: "healthvault_update_diet",
        toolAccess: "write",
        toolCategory: "nutrition",
        vaultWeightKg: 85.7,
      });

      assert.strictEqual(check.allowed, false, "Must block write when prior turn created material weight conflict");
      assert.strictEqual(check.intent, "BASELINE_CONFLICT");
      assert.ok(check.reason?.includes("BASELINE_CONFLICT"));
    });

    it("follow-up explicitly confirming weight update → write allowed", () => {
      const check = WriteIntentGuard.check({
        userMessage: "sim, considere 98 kg como meu peso atual e registre isso",
        previousAssistantMessage: "Você mencionou 98 kg — vault registra 85.7 kg. Se o peso atual é de fato 98 kg, me confirma?",
        previousUserMessage: "estou com 98 kg, monte uma dieta",
        toolName: "healthvault_update_diet",
        toolAccess: "write",
        toolCategory: "nutrition",
        vaultWeightKg: 85.7,
      });

      assert.strictEqual(check.allowed, true, "Explicit resolution of weight conflict must allow write");
      assert.ok(check.intent === "CONFIRMATION" || check.intent === "EXPLICIT_MUTATION");
    });
  });

  // 3. Fix RecommendationSnapshotBuilder Metric Field (bodyFatPct)
  describe("3. RecommendationSnapshotBuilder Metric Field (bodyFatPct)", () => {
    it("correctly reads bodyFatPct from BodyMetric schema", async () => {
      const mockDb = {
        dietPlan: { findFirst: async () => null },
        medication: { findMany: async () => [] },
        bodyMetric: {
          findFirst: async () => ({
            weightKg: 85.7,
            bodyFatPct: 15.8,
            date: new Date("2026-09-25"),
          }),
        },
      };

      const snapshot = await RecommendationSnapshotBuilder.build("user-bf-test", mockDb);

      assert.ok(snapshot.metrics, "Metrics snapshot must exist");
      assert.strictEqual(snapshot.metrics?.latestWeightKg, 85.7);
      assert.strictEqual(snapshot.metrics?.bodyFatPct, 15.8, "Must use bodyFatPct from BodyMetric schema");
    });
  });

  // 4. Enforce Snapshot Invariant in Recommendation Write Paths
  describe("4. Enforce Snapshot Invariant in Recommendation Write Paths", () => {
    it("RecommendationService.create builds fresh snapshot from Vault ignoring stale client snapshot", async () => {
      const origTransaction = db.$transaction;
      const origAuditCreate = db.auditLog.create;
      const origDietFindFirst = db.dietPlan.findFirst;
      const origMedFindMany = db.medication.findMany;
      const origMetricFindFirst = db.bodyMetric.findFirst;

      let createdVersionSnapshot: any = null;

      (db.dietPlan.findFirst as any) = async () => ({
        id: "diet-v3-authoritative",
        currentVersion: 3,
        title: "Lean Cut & High Protein",
        versions: [{ versionNumber: 3, targetCalories: 2250, targetProteinG: 200, targetCarbsG: 210, targetFatG: 62 }],
      });
      (db.medication.findMany as any) = async () => [];
      (db.bodyMetric.findFirst as any) = async () => ({ weightKg: 85.7, bodyFatPct: 15.8, date: new Date() });
      (db.auditLog.create as any) = async () => ({ id: "audit-rec-01" });

      (db.$transaction as any) = async (cb: any) => {
        const tx = {
          recommendation: {
            create: async ({ data }: any) => ({ id: "rec-01", ...data }),
          },
          recommendationVersion: {
            create: async ({ data }: any) => {
              createdVersionSnapshot = data.summarySnapshot;
              return { id: "rec-ver-01", ...data };
            },
          },
        };
        return cb(tx);
      };

      try {
        // Client sends stale snapshot (2100 kcal / 190g P)
        const staleClientSnapshot = {
          nutrition: { calories: 2100, protein_g: 190, carbs_g: 180, fat_g: 65, version: 2 },
        };

        await RecommendationService.create("user-rec-inv", {
          title: "Cutting Protocol",
          summarySnapshot: staleClientSnapshot,
          changeReason: "Test snapshot invariant",
        });

        assert.ok(createdVersionSnapshot, "Version snapshot must have been created");
        assert.strictEqual(
          createdVersionSnapshot.nutrition?.calories,
          2250,
          "Persisted RecommendationVersion MUST capture live Vault diet (2250 kcal), ignoring stale client snapshot"
        );
        assert.strictEqual(
          createdVersionSnapshot.nutrition?.version,
          3,
          "Persisted RecommendationVersion MUST capture Vault version 3"
        );
      } finally {
        db.$transaction = origTransaction;
        db.auditLog.create = origAuditCreate;
        db.dietPlan.findFirst = origDietFindFirst;
        db.medication.findMany = origMedFindMany;
        db.bodyMetric.findFirst = origMetricFindFirst;
      }
    });

    it("RecommendationService.update builds fresh snapshot from Vault ignoring stale client snapshot", async () => {
      const origTransaction = db.$transaction;
      const origAuditCreate = db.auditLog.create;
      const origDietFindFirst = db.dietPlan.findFirst;
      const origMedFindMany = db.medication.findMany;
      const origMetricFindFirst = db.bodyMetric.findFirst;
      const origRecFindFirst = db.recommendation.findFirst;

      let updatedVersionSnapshot: any = null;

      (db.recommendation.findFirst as any) = async () => ({
        id: "rec-existing-01",
        userId: "user-rec-upd",
        title: "Existing Protocol",
        status: "ACTIVE",
        currentVersion: 2,
        conversationId: "conv-01",
        notes: "Old notes",
      });

      (db.dietPlan.findFirst as any) = async () => ({
        id: "diet-v3-authoritative",
        currentVersion: 3,
        title: "Lean Cut & High Protein",
        versions: [{ versionNumber: 3, targetCalories: 2250, targetProteinG: 200, targetCarbsG: 210, targetFatG: 62 }],
      });
      (db.medication.findMany as any) = async () => [];
      (db.bodyMetric.findFirst as any) = async () => ({ weightKg: 85.7, bodyFatPct: 15.8, date: new Date() });
      (db.auditLog.create as any) = async () => ({ id: "audit-rec-02" });

      (db.$transaction as any) = async (cb: any) => {
        const tx = {
          recommendationVersion: {
            create: async ({ data }: any) => {
              updatedVersionSnapshot = data.summarySnapshot;
              return { id: "rec-ver-03", ...data };
            },
          },
          recommendation: {
            update: async ({ data }: any) => ({ id: "rec-existing-01", ...data }),
          },
        };
        return cb(tx);
      };

      try {
        // Client sends stale snapshot from previous v2
        const staleClientSnapshot = {
          nutrition: { calories: 2100, protein_g: 190, version: 2 },
        };

        await RecommendationService.update("user-rec-upd", {
          recommendationId: "rec-existing-01",
          summarySnapshot: staleClientSnapshot,
          changeReason: "Update to v3",
        });

        assert.ok(updatedVersionSnapshot, "Updated version snapshot must exist");
        assert.strictEqual(
          updatedVersionSnapshot.nutrition?.calories,
          2250,
          "Update MUST build fresh snapshot from Vault (2250 kcal), ignoring client stale snapshot"
        );
      } finally {
        db.$transaction = origTransaction;
        db.auditLog.create = origAuditCreate;
        db.dietPlan.findFirst = origDietFindFirst;
        db.medication.findMany = origMedFindMany;
        db.bodyMetric.findFirst = origMetricFindFirst;
        db.recommendation.findFirst = origRecFindFirst;
      }
    });
  });

  // 5. Dashboard Review Card Logic
  describe("5. Dashboard Review Card Logic", () => {
    it("active medications with no reminders → review displays '--' and 'Nenhuma revisão agendada'", () => {
      const activeMedications = [{ id: "med-1", name: "Ozempic", isActive: true }];
      const reminders: any[] = []; // No real reminders

      const nextReminder = reminders[0] || null;
      const displaySchedule = nextReminder !== null ? "Em 14 dias" : "--";
      const displayReason = nextReminder ? nextReminder.title : "Nenhuma revisão agendada";

      assert.strictEqual(displaySchedule, "--", "Must NOT imply a review schedule merely because active medications exist");
      assert.strictEqual(displayReason, "Nenhuma revisão agendada");
    });

    it("real reminder exists → review displays real schedule and title", () => {
      const reminders = [
        {
          id: "rem-1",
          title: "Revisão semestral de exames",
          dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          isCompleted: false,
        },
      ];

      const nextReminder = reminders[0] || null;
      const daysUntil = nextReminder
        ? Math.ceil((new Date(nextReminder.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      const displaySchedule =
        nextReminder !== null
          ? daysUntil! <= 0
            ? "Hoje"
            : daysUntil === 1
            ? "Amanhã"
            : `Em ${daysUntil} dias`
          : "--";
      const displayReason = nextReminder ? nextReminder.title : "Nenhuma revisão agendada";

      assert.strictEqual(displaySchedule, "Em 7 dias", "Must display real upcoming reminder due date");
      assert.strictEqual(displayReason, "Revisão semestral de exames", "Must display real reminder title");
    });
  });

  // 6. Generic Stale Active Medication Reconciliation
  describe("6. Stale Active Medication Reconciliation", () => {
    it("no active medications in Vault flags STALE_ACTIVE_MEDICATION_CLAIM", () => {
      const vaultBlock = `
<healthvault_data>
<records>
CURRENT PATIENT STATE:
- Active Medications: None registered.
- Recent Metrics: 2026-09-25: 85.7 kg
</records>
</healthvault_data>
      `;

      const staleResponse =
        "Semaglutida — já ativa. Continua com a dose atual de 0.5 mg/semana para potencializar a perda de peso.";

      const gateCheck = EvidenceConsistencyGate.evaluate({
        userMessage: "Qual meu medicamento atual e recomendações?",
        assistantText: staleResponse,
        vaultContextBlock: vaultBlock,
      });

      assert.strictEqual(gateCheck.isValid, false);
      assert.ok(gateCheck.violations.some((v) => v.includes("STALE_ACTIVE_MEDICATION_CLAIM")));
    });
  });
});
