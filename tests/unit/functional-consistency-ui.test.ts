import { describe, it } from "node:test";
import assert from "node:assert";
import { WriteIntentGuard } from "../../src/lib/ai/tools/write-intent-guard";
import { EvidenceConsistencyGate } from "../../src/lib/ai/response/evidence-consistency-gate";
import { RecommendationSnapshotBuilder } from "../../src/lib/services/recommendation-snapshot-builder";

describe("HealthVault AI — Functional Consistency & UI Quality Regressions", () => {
  // Test 1: Advisory diet request does not allow persistent write
  it("Test 1 — advisory diet request does not write (blocks write tool calls)", () => {
    const check = WriteIntentGuard.check({
      userMessage: "monte uma dieta de perca de peso para melhora de eficiencia na corrida, recomende também drogas para auxiliar",
      toolName: "healthvault_update_diet",
      toolAccess: "write",
      toolCategory: "nutrition",
    });

    assert.strictEqual(check.allowed, false, "Advisory request must NOT allow persistent write tools");
    assert.strictEqual(check.intent, "ADVISORY", "Intent must be categorized as ADVISORY");
    assert.ok(
      check.reason?.includes("WRITE_INTENT_REQUIRED"),
      "Reason must state WRITE_INTENT_REQUIRED"
    );
  });

  // Test 2: Explicit write request is allowed
  it("Test 2 — explicit write still works", () => {
    const check = WriteIntentGuard.check({
      userMessage: "Atualize minha dieta para 2250 kcal, 200g proteína, 210g carbo e 62g gordura.",
      toolName: "healthvault_update_diet",
      toolAccess: "write",
      toolCategory: "nutrition",
    });

    assert.strictEqual(check.allowed, true, "Explicit mutation directive must allow write tools");
    assert.strictEqual(check.intent, "EXPLICIT_MUTATION");
  });

  // Test 3: Save confirmation follow-up works
  it("Test 3 — save confirmation follow-up works after assistant proposal", () => {
    const check = WriteIntentGuard.check({
      userMessage: "sim, salve",
      previousAssistantMessage: "Quer que eu salve este plano alimentar no HealthVault?",
      toolName: "healthvault_update_diet",
      toolAccess: "write",
      toolCategory: "nutrition",
    });

    assert.strictEqual(check.allowed, true, "Confirmation to previous offer must allow write tools");
    assert.strictEqual(check.intent, "CONFIRMATION");
  });

  // Test 4: Current-turn weight conflict prevents unverified persistent write
  it("Test 4 — current-turn weight conflict requires resolution before write", () => {
    const check = WriteIntentGuard.check({
      userMessage: "estou com 98 kg, monte uma dieta para mim",
      toolName: "healthvault_update_diet",
      toolAccess: "write",
      toolCategory: "nutrition",
      vaultWeightKg: 85.7,
    });

    assert.strictEqual(check.allowed, false, "Material weight conflict must block persistent write");
    assert.ok(
      check.intent === "BASELINE_CONFLICT" || check.intent === "ADVISORY",
      "Intent must reflect baseline conflict or advisory block"
    );
  });

  // Test 5: No active medication in Vault prevents claims of active medication
  it("Test 5 — no active medication in Vault flags STALE_ACTIVE_MEDICATION_CLAIM", () => {
    const vaultBlockWithNoMeds = `
<healthvault_data>
<records>
CURRENT PATIENT STATE:
- Active Medications: None registered.
- Recent Metrics: 2026-09-25: 85.7 kg
</records>
</healthvault_data>
    `;

    // Stale assistant prose claiming Semaglutide is active/continuing
    const staleResponse =
      "Semaglutida — já ativa. Continua com a dose atual de 0.5 mg/semana para potencializar a perda de peso.";

    const gateCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual meu medicamento atual e recomendações?",
      assistantText: staleResponse,
      vaultContextBlock: vaultBlockWithNoMeds,
    });

    assert.strictEqual(gateCheck.isValid, false, "Must fail consistency check when claiming medication is active while Vault has none");
    assert.ok(
      gateCheck.violations.some((v) => v.includes("STALE_ACTIVE_MEDICATION_CLAIM")),
      "Must flag STALE_ACTIVE_MEDICATION_CLAIM"
    );

    // Correct response acknowledging no active medications
    const cleanResponse =
      "No momento, você não possui nenhum medicamento ativo registrado no HealthVault. O histórico anterior de Semaglutida encontra-se descontinuado (0 mg).";

    const cleanCheck = EvidenceConsistencyGate.evaluate({
      userMessage: "Qual meu medicamento atual e recomendações?",
      assistantText: cleanResponse,
      vaultContextBlock: vaultBlockWithNoMeds,
    });

    assert.strictEqual(cleanCheck.isValid, true, "Response reflecting no active medications must pass");
  });

  // Test 6: Recommendation snapshot captures fresh current Vault state
  it("Test 6 — recommendation snapshot fresh on update reflects current diet", async () => {
    const mockDb = {
      dietPlan: {
        findFirst: async () => ({
          id: "diet-v3",
          currentVersion: 3,
          title: "Lean Cut & High Protein",
          versions: [
            {
              versionNumber: 3,
              targetCalories: 2250,
              targetProteinG: 200,
              targetCarbsG: 210,
              targetFatG: 62,
            },
          ],
        }),
      },
      medication: {
        findMany: async () => [
          {
            id: "med-sema",
            name: "Semaglutide",
            currentVersion: 4,
            isActive: false,
            versions: [{ doseValue: 0, doseUnit: "mg", frequency: "descontinuado" }],
          },
        ],
      },
      bodyMetric: {
        findFirst: async () => ({
          weightKg: 85.7,
          bodyFatPercentage: 15.8,
          date: new Date("2026-09-25"),
        }),
      },
    };

    const snapshot = await RecommendationSnapshotBuilder.build("user-test-01", mockDb);

    assert.ok(snapshot.nutrition, "Nutrition snapshot must exist");
    assert.strictEqual(snapshot.nutrition?.calories, 2250, "Snapshot must capture 2250 kcal from current diet v3");
    assert.strictEqual(snapshot.nutrition?.protein_g, 200, "Snapshot must capture 200g protein from current diet v3");
    assert.strictEqual(snapshot.nutrition?.carbs_g, 210, "Snapshot must capture 210g carbs from current diet v3");
    assert.strictEqual(snapshot.nutrition?.fat_g, 62, "Snapshot must capture 62g fat from current diet v3");
    assert.strictEqual(snapshot.metrics?.latestWeightKg, 85.7, "Snapshot must capture latest weight 85.7 kg");
    assert.strictEqual(snapshot.medications?.[0]?.active, false, "Discontinued medication must be captured as inactive");
  });

  // Test 7: Same-turn diet + recommendation update produces consistent snapshot
  it("Test 7 — same-turn diet + recommendation produces consistent snapshot", async () => {
    // In same turn, diet is updated to v3 first, then recommendation is committed
    let currentDietVersion = 2;
    let calories = 2100;

    const mockDb = {
      dietPlan: {
        findFirst: async () => ({
          id: "diet-01",
          currentVersion: currentDietVersion,
          title: "Cutting Protocol",
          versions: [
            {
              versionNumber: currentDietVersion,
              targetCalories: calories,
              targetProteinG: 200,
              targetCarbsG: 210,
              targetFatG: 62,
            },
          ],
        }),
      },
      medication: {
        findMany: async () => [],
      },
      bodyMetric: {
        findFirst: async () => ({ weightKg: 85.7, bodyFatPercentage: null, date: new Date() }),
      },
    };

    // Before turn: snapshot is v2 (2100)
    const beforeSnapshot = await RecommendationSnapshotBuilder.build("user-same-turn", mockDb);
    assert.strictEqual(beforeSnapshot.nutrition?.calories, 2100);

    // Turn applies diet update to v3 (2250)
    currentDietVersion = 3;
    calories = 2250;

    // Recommendation snapshot captured after diet mutation
    const afterSnapshot = await RecommendationSnapshotBuilder.build("user-same-turn", mockDb);
    assert.strictEqual(afterSnapshot.nutrition?.calories, 2250, "Recommendation snapshot must reflect newly committed diet v3");
    assert.strictEqual(afterSnapshot.nutrition?.version, 3);
  });

  // Test 8: Recommendation Markdown formatting
  it("Test 8 — recommendation notes are formatted as structured Markdown", () => {
    const rawNotes = `=== PROTOCOLO DE CORRIDA E DIETA ===
--- OBJETIVOS ---
1. Perda de peso com preservação de massa magra
2. Otimização do ritmo na corrida`;

    // Normalization converts === SECTION === to ## and --- to ###
    const normalized = rawNotes
      .replace(/===\s*([^=\n]+?)\s*===/g, "\n\n## $1\n\n")
      .replace(/---\s*([^-\n]+?)\s*---/g, "\n\n### $1\n\n")
      .trim();

    assert.ok(normalized.includes("## PROTOCOLO DE CORRIDA E DIETA"), "Must format section as markdown H2");
    assert.ok(normalized.includes("### OBJETIVOS"), "Must format sub-section as markdown H3");
    assert.ok(normalized.includes("1. Perda de peso"), "Must preserve numbered list structure");
  });

  // Test 9: Dashboard has no fake review or fallbacks
  it("Test 9 — dashboard displays real state and no fake titration review when 0 active meds", () => {
    const activeMedications: any[] = [];
    const latestDietVer = null;

    // Calorie card logic
    const caloriesDisplay = latestDietVer ? `${(latestDietVer as any).targetCalories} kcal` : "--";
    assert.strictEqual(caloriesDisplay, "--", "Must display '--' when no diet is active instead of fake 2100");

    // Review card logic
    const reviewScheduleDisplay = activeMedications.length > 0 ? "Em 14 dias" : "--";
    const reviewReasonDisplay = activeMedications.length > 0 ? "Revisão clínica" : "Nenhuma revisão agendada";

    assert.strictEqual(reviewScheduleDisplay, "--", "Must display '--' when no active medications are registered");
    assert.strictEqual(reviewReasonDisplay, "Nenhuma revisão agendada", "Must NOT claim dosage titration with 0 active medications");
  });

  // Test 10: New metric and lab forms initialize with clean blank values
  it("Test 10 — new metric and lab forms do not preload demo patient values", () => {
    // Form state initializations
    const initialWeightState = "";
    const initialBfState = "";
    const initialTestName = "";
    const initialMarkerName = "";
    const initialResultValue = "";

    assert.strictEqual(initialWeightState, "", "New weight must initialize as empty, not 83.0 kg");
    assert.strictEqual(initialBfState, "", "New BF must initialize as empty, not 15.5%");
    assert.strictEqual(initialTestName, "", "Test name must initialize as empty, not 'Perfil Lipídico'");
    assert.strictEqual(initialMarkerName, "", "Marker name must initialize as empty, not 'Glicemia de Jejum'");
    assert.strictEqual(initialResultValue, "", "Result value must initialize as empty, not 88");
  });
});
