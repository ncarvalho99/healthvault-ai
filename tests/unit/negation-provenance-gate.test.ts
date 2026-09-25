import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WriteIntentGuard, resolveWriteScope } from "../../src/lib/ai/tools/write-intent-guard";
import { detectTopics, mentionedWriteDomains } from "../../src/lib/ai/tools/domain-intent";
import { upsertCurrentPlanSection, planFromDietArgs, CURRENT_PLAN_HEADING } from "../../src/lib/services/protocol-notes";
import { recommendationOriginLabel } from "../../src/lib/recommendation-origin";
import { EvidenceConsistencyGate } from "../../src/lib/ai/response/evidence-consistency-gate";

const guard = (userMessage: string, toolName: string, toolCategory: string, extra: Record<string, any> = {}) =>
  WriteIntentGuard.check({ userMessage, toolName, toolAccess: "write", toolCategory, ...extra });

const EMPTY_MEDS_VAULT = `
<healthvault_data>
<records>
CURRENT PATIENT STATE:
- Active Medications: None registered.
- Recent Metrics: 2026-09-25: 98 kg
</records>
</healthvault_data>
`;

describe("Negation, least-privilege domains, provenance and gate precision", () => {
  describe("1. Negated write verbs never authorize a write", () => {
    for (const [msg, tool, category] of [
      ["não salve minha dieta", "healthvault_update_diet", "nutrition"],
      ["não altere meu medicamento", "healthvault_update_medication", "medications"],
      ["não registre meu peso", "healthvault_add_body_metric", "metrics"],
      ["não quero que você salve a dieta", "healthvault_update_diet", "nutrition"],
    ] as const) {
      it(`'${msg}' → blocked`, () => {
        const check = guard(msg, tool, category);
        assert.strictEqual(check.allowed, false);
        assert.strictEqual(check.intent, "NO_WRITE_INTENT");
      });
    }

    it("a negated clause denies its domain even when another clause authorizes something else", () => {
      const msg = "salve a dieta mas não registre o peso";
      assert.strictEqual(guard(msg, "healthvault_update_diet", "nutrition").allowed, true);
      assert.strictEqual(guard(msg, "healthvault_add_body_metric", "metrics").allowed, false);
    });

    it("'não, salve só a dieta' still authorizes the diet", () => {
      assert.deepStrictEqual([...resolveWriteScope("Não, salve só a dieta").domains], ["nutrition"]);
    });
  });

  describe("2. Recommendation and nutrition are separate domains", () => {
    it("'salve esta recomendação' authorizes recommendations only", () => {
      assert.strictEqual(guard("salve esta recomendação", "healthvault_update_recommendation", "recommendations").allowed, true);
      assert.strictEqual(guard("salve esta recomendação", "healthvault_update_diet", "nutrition").allowed, false);
    });

    it("'salve o plano' authorizes nutrition only; naming the protocol adds recommendations", () => {
      assert.deepStrictEqual([...mentionedWriteDomains("salve o plano")], ["nutrition"]);
      assert.deepStrictEqual(
        [...mentionedWriteDomains("salve o plano e atualize o protocolo")].sort(),
        ["nutrition", "recommendations"]
      );
    });
  });

  describe("3. Medication topic detection", () => {
    for (const msg of ["mude para 2mg", "mude para 2 mg", "0.25mcg por dia"]) {
      it(`'${msg}' is a medication topic`, () => {
        assert.strictEqual(detectTopics(msg).medication, true);
      });
    }
    it("'mg' inside words is not a medication topic", () => {
      assert.strictEqual(detectTopics("programa de treino").medication, false);
    });
  });

  describe("4. Protocol notes show the saved plan once", () => {
    const plan = planFromDietArgs(
      { target_calories: 2250, target_protein_g: 215, target_carbs_g: 200, target_fat_g: 68, reason: "Ajuste de cutting" },
      98,
      new Date("2026-09-25T16:00:00Z")
    );

    it("appends the section to existing notes", () => {
      const notes = upsertCurrentPlanSection("## Objetivo\n\nCutting com corrida.", plan);
      assert.ok(notes.startsWith("## Objetivo"));
      assert.ok(notes.includes(CURRENT_PLAN_HEADING));
      assert.ok(notes.includes("2250 kcal"));
      assert.ok(notes.includes("98 kg"));
    });

    it("replaces the previous section instead of duplicating it, keeping later sections", () => {
      const first = upsertCurrentPlanSection("## Objetivo\n\nCutting.", plan) + "\n\n## Observações\n\nSem restrições.";
      const next = upsertCurrentPlanSection(first, { ...plan, calories: 2100 });
      assert.strictEqual(next.split(CURRENT_PLAN_HEADING).length - 1, 1);
      assert.ok(next.includes("2100 kcal"));
      assert.ok(!next.includes("2250 kcal"));
      assert.ok(next.includes("## Observações"));
    });
  });

  describe("5. Provenance is fixed server-side and displayed from sourceType", () => {
    it("manual routes do not accept source/actor provenance from the client", () => {
      const root = join(__dirname, "../../src/app/api/recommendations");
      const collection = readFileSync(join(root, "route.ts"), "utf-8");
      const item = readFileSync(join(root, "[id]", "route.ts"), "utf-8");
      assert.ok(!/sourceType:\s*z\./.test(collection), "POST schema must not accept sourceType");
      assert.ok(collection.includes("sourceType: SourceType.USER_NOTE"));
      assert.ok(!/actorType:\s*z\./.test(item), "PUT schema must not accept actorType");
      assert.ok(item.includes("actorType: ActorType.USER"));
    });

    it("origin label never defaults to the AI", () => {
      assert.strictEqual(recommendationOriginLabel("USER_NOTE", null), "Registro manual");
      assert.strictEqual(recommendationOriginLabel("AI_AGENT", null), "Assistente de IA");
      assert.strictEqual(recommendationOriginLabel(null, null), "Origem não informada");
    });

    it("chat integration fallback is restricted to ADMIN-owned integrations", () => {
      const route = readFileSync(join(__dirname, "../../src/app/api/ai/chat/route.ts"), "utf-8");
      assert.ok(!/where:\s*\{\s*enabled:\s*true\s*\}/.test(route), "no unscoped 'any enabled integration' lookup");
      assert.ok(route.includes('user: { role: "ADMIN" }'));
    });
  });

  describe("6. Consistency gate precision", () => {
    it("'Continue com a dieta atual' is not a medication claim when no medication is active", () => {
      const check = EvidenceConsistencyGate.evaluate({
        userMessage: "Como fica minha dieta?",
        assistantText: "Continue com a dieta atual. Mantém 2250 kcal com 215 g de proteína.",
        vaultContextBlock: EMPTY_MEDS_VAULT,
      });
      assert.ok(!check.violations.some((v) => v.includes("STALE_ACTIVE_MEDICATION_CLAIM")));
    });

    it("a real stale medication claim is still flagged", () => {
      const check = EvidenceConsistencyGate.evaluate({
        userMessage: "E o remédio?",
        assistantText: "Continue com a semaglutida na dose atual de 0.5 mg.",
        vaultContextBlock: EMPTY_MEDS_VAULT,
      });
      assert.ok(check.violations.some((v) => v.includes("STALE_ACTIVE_MEDICATION_CLAIM")));
    });

    it("jurisdiction-scoped approval statements are not a contradiction", () => {
      const check = EvidenceConsistencyGate.evaluate({
        userMessage: "É aprovado?",
        assistantText: "No Brasil, não é aprovado para nenhuma indicação pela Anvisa. Nos EUA, é aprovado pela FDA para obesidade.",
      });
      assert.ok(!check.violations.some((v) => v.includes("MUTUALLY_INCOMPATIBLE_CLAIMS")));
    });

    it("an unscoped absolute denial next to an approval is still a contradiction", () => {
      const check = EvidenceConsistencyGate.evaluate({
        userMessage: "É aprovado?",
        assistantText: "Não é aprovado para nenhuma indicação. Ele é aprovado para obesidade.",
      });
      assert.ok(check.violations.some((v) => v.includes("MUTUALLY_INCOMPATIBLE_CLAIMS")));
    });
  });
});
