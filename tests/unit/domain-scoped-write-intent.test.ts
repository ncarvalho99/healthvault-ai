import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolSelector } from "../../src/lib/ai/tools/selector";
import {
  WriteIntentGuard,
  createTurnMutationState,
  recordTurnMutation,
  computePendingBaselineConflict,
} from "../../src/lib/ai/tools/write-intent-guard";
import { parseReportedWeightKg } from "../../src/lib/ai/tools/domain-intent";
import { RecommendationSnapshotBuilder } from "../../src/lib/services/recommendation-snapshot-builder";
import { RecommendationService } from "../../src/lib/services/recommendation-service";
import { db } from "../../src/lib/db";

const guard = (userMessage: string, toolName: string, toolCategory: string, extra: Record<string, any> = {}) =>
  WriteIntentGuard.check({ userMessage, toolName, toolAccess: "write", toolCategory, ...extra });

describe("Domain-scoped write intent", () => {
  describe("1. A write instruction only authorizes the domains it names", () => {
    const dietOffer = "Proposta pronta. Quer que eu salve esta dieta no HealthVault?";

    it("'sim' after a diet offer authorizes diet but not metrics or medications", () => {
      assert.strictEqual(guard("sim", "healthvault_update_diet", "nutrition", { previousAssistantMessage: dietOffer }).allowed, true);

      const metric = guard("sim", "healthvault_add_body_metric", "metrics", { previousAssistantMessage: dietOffer });
      assert.strictEqual(metric.allowed, false);
      assert.strictEqual(metric.intent, "DOMAIN_NOT_AUTHORIZED");

      const med = guard("sim", "healthvault_create_medication", "medications", { previousAssistantMessage: dietOffer });
      assert.strictEqual(med.allowed, false);
      assert.strictEqual(med.intent, "DOMAIN_NOT_AUTHORIZED");
    });

    it("'sim' after a diet offer does not expose the whole tool pool", () => {
      const names = ToolSelector.selectTools({ userMessage: "sim", previousAssistantMessage: dietOffer, agentMode: "AGENT" }).map((t) => t.name);
      assert.ok(names.includes("healthvault_update_diet"));
      assert.strictEqual(names.includes("healthvault_add_body_metric"), false);
      assert.strictEqual(names.includes("healthvault_create_medication"), false);
      assert.strictEqual(names.includes("healthvault_add_lab_result"), false);
    });

    it("'registre meu peso ... e me recomende um medicamento' writes the weight, never a medication", () => {
      const msg = "Registre meu peso como 98 kg e me recomende um medicamento para emagrecer.";
      assert.strictEqual(guard(msg, "healthvault_add_body_metric", "metrics").allowed, true);

      const med = guard(msg, "healthvault_create_medication", "medications");
      assert.strictEqual(med.allowed, false);
      assert.strictEqual(med.intent, "DOMAIN_NOT_AUTHORIZED");
    });

    it("'salve minha dieta e me recomende medicamentos' saves the diet only", () => {
      const msg = "salve minha dieta e me recomende medicamentos";
      assert.strictEqual(guard(msg, "healthvault_update_diet", "nutrition").allowed, true);
      assert.strictEqual(guard(msg, "healthvault_create_recommendation", "recommendations").allowed, false);
      assert.strictEqual(guard(msg, "healthvault_update_medication", "medications").allowed, false);
    });

    it("a clause without its own verb inherits the write mode ('atualize minha dieta e medicação')", () => {
      const msg = "atualize minha dieta e medicação";
      assert.strictEqual(guard(msg, "healthvault_update_diet", "nutrition").allowed, true);
      assert.strictEqual(guard(msg, "healthvault_update_medication", "medications").allowed, true);
    });

    it("'sim, salve' binds to the domains of the previous offer", () => {
      const offer = "Quer que eu registre o peso de 98 kg e aplique os novos macros na dieta?";
      assert.strictEqual(guard("sim, salve", "healthvault_add_body_metric", "metrics", { previousAssistantMessage: offer }).allowed, true);
      assert.strictEqual(guard("sim, salve", "healthvault_update_diet", "nutrition", { previousAssistantMessage: offer }).allowed, true);
      assert.strictEqual(guard("sim, salve", "healthvault_add_lab_result", "labs", { previousAssistantMessage: offer }).allowed, false);
    });
  });

  describe("1b. Browser session of 2026-09-25 (verbatim messages)", () => {
    const advisory = "Estou com 98 kg. Monte uma proposta de dieta para cutting com base no meu estado atual.";
    const offer =
      "Diferença pequena — a dieta ativa já é bem calibrada. Quer que eu salve o peso de 98 kg no vault e aplique essa atualização de macros na dieta ativa? Confirma com \"salva\" ou \"aplica\" e executo os dois registros.";
    const confirm = "Sim. Atualize meu peso para 98 kg e salve o plano proposto no HealthVault.";

    it("advisory turn: no write, and the conflict is carried to the next turn", () => {
      assert.strictEqual(guard(advisory, "healthvault_add_body_metric", "metrics", { vaultWeightKg: 85.7 }).intent, "ADVISORY");
      assert.deepStrictEqual(
        computePendingBaselineConflict(advisory, 85.7, null, createTurnMutationState()),
        { reportedWeightKg: 98, vaultWeightKg: 85.7 }
      );
    });

    it("confirmation turn: metric, then diet once the weight is persisted; the protocol needs its own authorization", () => {
      const pending = { reportedWeightKg: 98, vaultWeightKg: 85.7 };
      const state = createTurnMutationState();
      const ctx = { previousAssistantMessage: offer, vaultWeightKg: 85.7, pendingBaselineConflict: pending, turnMutationState: state };

      assert.strictEqual(guard(confirm, "healthvault_add_body_metric", "metrics", ctx).allowed, true);
      assert.strictEqual(guard(confirm, "healthvault_update_diet", "nutrition", ctx).intent, "BASELINE_CONFLICT");

      recordTurnMutation(state, "healthvault_add_body_metric", { success: true, data: { weightKg: 98 } });
      assert.strictEqual(guard(confirm, "healthvault_update_diet", "nutrition", ctx).allowed, true);
      assert.strictEqual(guard(confirm, "healthvault_update_recommendation", "recommendations", ctx).allowed, false);
      const withProtocol = "Sim. Atualize meu peso para 98 kg, salve o plano proposto e atualize o protocolo.";
      assert.strictEqual(guard(withProtocol, "healthvault_update_recommendation", "recommendations", ctx).allowed, true);
      assert.strictEqual(guard(confirm, "healthvault_create_medication", "medications", ctx).allowed, false);
      assert.strictEqual(computePendingBaselineConflict(confirm, 85.7, pending, state), null, "conflict cleared");
    });
  });

  describe("2. Weight conflict is explicit state, not a scan of old history", () => {
    it("a pending conflict measured against an older Vault value is superseded", () => {
      // Conflict raised when the Vault had 85.7; the Vault has since been updated to 90
      const check = guard("salve minha dieta", "healthvault_update_diet", "nutrition", {
        vaultWeightKg: 90,
        pendingBaselineConflict: { reportedWeightKg: 98, vaultWeightKg: 85.7 },
      });
      assert.strictEqual(check.allowed, true);
    });

    it("a pending conflict against the current Vault value still blocks", () => {
      const check = guard("salve minha dieta", "healthvault_update_diet", "nutrition", {
        vaultWeightKg: 85.7,
        pendingBaselineConflict: { reportedWeightKg: 98, vaultWeightKg: 85.7 },
      });
      assert.strictEqual(check.intent, "BASELINE_CONFLICT");
    });

    it("computePendingBaselineConflict: raised, carried, resolved", () => {
      const state = createTurnMutationState();
      const raised = computePendingBaselineConflict("estou com 98 kg, monte uma dieta", 85.7, null, state);
      assert.deepStrictEqual(raised, { reportedWeightKg: 98, vaultWeightKg: 85.7 });

      const carried = computePendingBaselineConflict("quanto de proteína?", 85.7, raised, state);
      assert.deepStrictEqual(carried, raised);

      assert.strictEqual(computePendingBaselineConflict("quanto de proteína?", 90, raised, state), null, "Vault changed");

      const resolved = createTurnMutationState();
      recordTurnMutation(resolved, "healthvault_add_body_metric", { success: true, data: { weightKg: 98 } });
      assert.strictEqual(computePendingBaselineConflict("sim, registre 98 kg como meu peso", 85.7, raised, resolved), null);
    });

    it("kg values that are not body weight do not create a conflict", () => {
      assert.strictEqual(parseReportedWeightKg("levanto 100 kg no supino"), null);
      assert.strictEqual(guard("levanto 100 kg no supino, salve minha dieta", "healthvault_update_diet", "nutrition", { vaultWeightKg: 85 }).allowed, true);
    });
  });

  describe("3. Turn state tracks persisted diet and handled recommendations", () => {
    it("persisted diet counts, pending-approval diet does not", () => {
      const persisted = createTurnMutationState();
      recordTurnMutation(persisted, "healthvault_update_diet", { success: true, data: { entity: "diet", version: 4 } });
      assert.strictEqual(persisted.dietUpdatedThisTurn, true);

      const pending = createTurnMutationState();
      recordTurnMutation(pending, "healthvault_update_diet", { success: true, requires_approval: true });
      assert.strictEqual(pending.dietUpdatedThisTurn, false);
    });

    it("a recommendation proposed by the model marks the turn as handled", () => {
      const state = createTurnMutationState();
      recordTurnMutation(state, "healthvault_update_recommendation", { success: true, requires_approval: true });
      assert.strictEqual(state.recommendationHandledThisTurn, true);
    });
  });

  describe("4. Snapshot builder fails closed", () => {
    it("a medication read error aborts the recommendation instead of snapshotting 'no medications'", async () => {
      const origTransaction = db.$transaction;
      const origDiet = db.dietPlan.findFirst;
      const origMeds = db.medication.findMany;
      const origMetric = db.bodyMetric.findFirst;
      const origAudit = db.auditLog.create;
      let versionCreated = false;

      (db.dietPlan.findFirst as any) = async () => null;
      (db.medication.findMany as any) = async () => {
        throw new Error("connection reset");
      };
      (db.bodyMetric.findFirst as any) = async () => null;
      (db.auditLog.create as any) = async () => ({ id: "audit" });
      (db.$transaction as any) = async (cb: any) =>
        cb({
          recommendation: { create: async ({ data }: any) => ({ id: "rec-x", ...data }) },
          recommendationVersion: {
            create: async () => {
              versionCreated = true;
              return {};
            },
          },
        });

      try {
        await assert.rejects(() => RecommendationSnapshotBuilder.build("user-x"), /connection reset/);
        await assert.rejects(() => RecommendationService.create("user-x", { title: "Plano" }), /connection reset/);
        assert.strictEqual(versionCreated, false, "no RecommendationVersion may be written with a partial snapshot");
      } finally {
        db.$transaction = origTransaction;
        db.dietPlan.findFirst = origDiet;
        db.medication.findMany = origMeds;
        db.bodyMetric.findFirst = origMetric;
        db.auditLog.create = origAudit;
      }
    });
  });
});
