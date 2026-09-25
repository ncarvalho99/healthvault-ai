import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  assertOwnedConversation,
  assertOwnedMedication,
  assertOwnedRecommendation,
  assertOwnedRefs,
  OwnershipError,
  ownershipErrorResponse,
  stripForeignRelation,
} from "../../src/lib/ownership";
import { WriteIntentGuard, resolveWriteScope } from "../../src/lib/ai/tools/write-intent-guard";
import { findSaveOfferSentence } from "../../src/lib/ai/tools/domain-intent";
import {
  displayRecommendationStatus,
  isManualRecommendationStatusAllowed,
  manualRecommendationStatusOptions,
} from "../../src/lib/recommendation-origin";
import { CURRENT_PLAN_HEADING, selectNutritionProtocolTarget } from "../../src/lib/services/protocol-notes";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

// In-memory ownership store: user-a owns conv-a/med-a/rec-a, user-b owns conv-b/med-b/rec-b.
const rows: Record<string, Array<{ id: string; userId: string }>> = {
  conversation: [{ id: "conv-a", userId: "user-a" }, { id: "conv-b", userId: "user-b" }],
  medication: [{ id: "med-a", userId: "user-a" }, { id: "med-b", userId: "user-b" }],
  recommendation: [{ id: "rec-a", userId: "user-a" }, { id: "rec-b", userId: "user-b" }],
};
const table = (name: string) => ({
  findFirst: async ({ where }: any) =>
    rows[name].find((r) => r.id === where.id && r.userId === where.userId) ?? null,
});
const client = { conversation: table("conversation"), medication: table("medication"), recommendation: table("recommendation") };

const guard = (userMessage: string, toolName: string, toolCategory: string, previousAssistantMessage = "") =>
  WriteIntentGuard.check({ userMessage, toolName, toolAccess: "write", toolCategory, previousAssistantMessage });

function listRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listRoutes(full);
    return entry === "route.ts" ? [full] : [];
  });
}

describe("Tenant isolation, negation scope, status provenance and protocol target", () => {
  describe("1. Ownership of client-supplied foreign keys", () => {
    it("own ids pass; undefined/null are skipped", async () => {
      await assertOwnedConversation("user-a", "conv-a", client);
      await assertOwnedMedication("user-a", "med-a", client);
      await assertOwnedRecommendation("user-a", "rec-a", client);
      await assertOwnedRefs("user-a", { conversationId: undefined, medicationId: null }, client);
    });

    for (const [label, fn, id] of [
      ["conversation", assertOwnedConversation, "conv-b"],
      ["medication", assertOwnedMedication, "med-b"],
      ["recommendation", assertOwnedRecommendation, "rec-b"],
    ] as const) {
      it(`user A cannot reference user B's ${label}`, async () => {
        await assert.rejects(fn("user-a", id, client), OwnershipError);
      });
    }

    it("assertOwnedRefs rejects when any one of several refs is foreign", async () => {
      await assert.rejects(
        assertOwnedRefs("user-a", { conversationId: "conv-a", medicationId: "med-b" }, client),
        (e: any) => e instanceof OwnershipError && e.entity === "medication"
      );
    });

    it("ownership failures map to 404 (no UUID oracle); other errors are not swallowed", async () => {
      const res = ownershipErrorResponse(new OwnershipError("conversation", "conv-b"));
      assert.ok(res);
      assert.strictEqual(res!.status, 404);
      const body = await res!.json();
      assert.strictEqual(body.code, "FOREIGN_KEY_NOT_OWNED");
      assert.strictEqual(ownershipErrorResponse(new Error("boom")), null);
    });

    it("reads drop relations that belong to another user and never leak their userId", () => {
      const foreign = stripForeignRelation({ id: "m1", recommendation: { id: "rec-b", title: "B", userId: "user-b" } }, "recommendation", "user-a");
      assert.strictEqual(foreign.recommendation, null);
      const own = stripForeignRelation({ id: "m2", recommendation: { id: "rec-a", title: "A", userId: "user-a" } }, "recommendation", "user-a");
      assert.deepStrictEqual(own.recommendation, { id: "rec-a", title: "A" });
    });

    it("every REST route accepting a related id in its body validates ownership before writing", () => {
      const offenders: string[] = [];
      for (const file of listRoutes(join(ROOT, "src", "app", "api"))) {
        const src = readFileSync(file, "utf-8");
        const fks = ["conversationId", "medicationId", "recommendationId"].filter((fk) =>
          new RegExp(`\\b${fk}:\\s*z\\.`).test(src)
        );
        // /api/ai/chat verifies its own conversation inline (findFirst with userId)
        if (fks.length === 0 || file.includes(join("ai", "chat"))) continue;
        if (!/assertOwned(Conversation|Medication|Recommendation|Refs)\(/.test(src)) {
          offenders.push(`${relative(ROOT, file)} (${fks.join(", ")})`);
        }
      }
      assert.deepStrictEqual(offenders, []);
    });

    it("symptoms validate both medicationId and conversationId; medications validate recommendationId", () => {
      assert.match(read("src/app/api/health/symptoms/route.ts"), /assertOwnedRefs\(user!\.userId, \{ conversationId, medicationId \}\)/);
      assert.match(read("src/app/api/medications/route.ts"), /assertOwnedRefs\(user!\.userId, \{ conversationId, recommendationId \}\)/);
    });

    it("conversation endpoints only attach the owner's recommendations", () => {
      assert.match(read("src/app/api/conversations/[id]/route.ts"), /recommendations: \{\s*\/\/[^\n]*\n\s*where: \{ userId: user!\.userId \}/);
      assert.match(read("src/app/api/conversations/route.ts"), /recommendations: \{\s*where: \{ userId: user!\.userId \}/);
    });

    it("manual medication APIs no longer accept actorType/actorName from the client", () => {
      for (const p of ["src/app/api/medications/route.ts", "src/app/api/medications/[id]/versions/route.ts"]) {
        const src = read(p);
        assert.doesNotMatch(src, /actorType:\s*z\./, p);
        assert.doesNotMatch(src, /actorName:\s*z\./, p);
        assert.match(src, /const actorType = ActorType\.USER;/, p);
      }
    });

    it("recommendation REST schemas no longer accept summarySnapshot", () => {
      for (const p of ["src/app/api/recommendations/route.ts", "src/app/api/recommendations/[id]/route.ts"]) {
        assert.doesNotMatch(read(p), /summarySnapshot:\s*z\./, p);
      }
    });
  });

  describe("2. Inherited negation and positive save offers", () => {
    for (const [msg, allowedDomain, deniedTool, deniedCategory] of [
      ["salve a dieta, não o peso", "nutrition", "healthvault_add_body_metric", "metrics"],
      ["salve a dieta, não o protocolo", "nutrition", "healthvault_create_recommendation", "recommendations"],
      ["atualize o peso, menos a medicação", "metrics", "healthvault_update_medication", "medications"],
      ["atualize o peso menos a medicação", "metrics", "healthvault_update_medication", "medications"],
      ["salve a dieta mas nem o peso", "nutrition", "healthvault_add_body_metric", "metrics"],
    ] as const) {
      it(`'${msg}' → ${allowedDomain} only; ${deniedCategory} blocked`, () => {
        const scope = resolveWriteScope(msg);
        assert.strictEqual(scope.mode, "MUTATION");
        assert.deepStrictEqual(Array.from(scope.domains), [allowedDomain]);
        assert.strictEqual(guard(msg, deniedTool, deniedCategory).allowed, false);
      });
    }

    it("'salve tudo exceto o peso' after an offer of diet + weight authorizes only the diet", () => {
      const offer = "Quer que eu salve a dieta e registre o peso de 98 kg?";
      const scope = resolveWriteScope("salve tudo exceto o peso", offer);
      assert.deepStrictEqual(Array.from(scope.domains), ["nutrition"]);
    });

    it("verb-less clauses after an exclusion stay excluded (least privilege)", () => {
      const scope = resolveWriteScope("salve a dieta mas não o peso e a medicação");
      assert.deepStrictEqual(Array.from(scope.domains), ["nutrition"]);
    });

    it("'menos' without a determiner is a diet instruction, not an exclusion", () => {
      const scope = resolveWriteScope("salve a dieta com menos carboidrato");
      assert.deepStrictEqual(Array.from(scope.domains), ["nutrition"]);
    });

    it("a negated statement about saving is not an offer; 'sim' after it confirms nothing", () => {
      const prev = "Não vou salvar o plano sem sua autorização.";
      assert.strictEqual(findSaveOfferSentence(prev), null);
      assert.strictEqual(resolveWriteScope("sim", prev).mode, "NONE");
      assert.strictEqual(guard("sim", "healthvault_update_diet", "nutrition", prev).allowed, false);
    });

    it("'salvar o plano' is only an offer when asked as a question", () => {
      assert.strictEqual(findSaveOfferSentence("Vou salvar o plano quando você pedir."), null);
      assert.ok(findSaveOfferSentence("Posso ajustar. Salvar o plano?"));
    });

    it("a real offer earlier in the message still binds when a later sentence is a negated statement", () => {
      const prev = "Quer que eu salve a dieta? Não vou salvar nada sem sua autorização.";
      assert.strictEqual(findSaveOfferSentence(prev), "Quer que eu salve a dieta?");
      assert.strictEqual(guard("sim", "healthvault_update_diet", "nutrition", prev).allowed, true);
    });
  });

  describe("3. Recommendation status requires a trusted origin", () => {
    it("a manual record cannot be self-assigned DOCTOR_RECOMMENDATION or CONFIRMED", () => {
      assert.strictEqual(isManualRecommendationStatusAllowed("DOCTOR_RECOMMENDATION", "USER_NOTE", "USER_NOTE"), false);
      assert.strictEqual(isManualRecommendationStatusAllowed("CONFIRMED", "USER_NOTE", "USER_NOTE"), false);
      assert.strictEqual(isManualRecommendationStatusAllowed("CONFIRMED", "AI_AGENT", "AI_SUGGESTION"), false);
      assert.strictEqual(isManualRecommendationStatusAllowed("ARCHIVED", "USER_NOTE", "USER_NOTE"), true);
    });

    it("AI_SUGGESTION is only available for AI-sourced records; current status is always kept", () => {
      assert.ok(manualRecommendationStatusOptions("AI_AGENT", "ARCHIVED").includes("AI_SUGGESTION"));
      assert.ok(!manualRecommendationStatusOptions("USER_NOTE", "USER_NOTE").includes("AI_SUGGESTION"));
      assert.ok(!manualRecommendationStatusOptions("USER_NOTE", "USER_NOTE").includes("DOCTOR_RECOMMENDATION"));
      assert.ok(manualRecommendationStatusOptions("DOCTOR", "DOCTOR_RECOMMENDATION").includes("DOCTOR_RECOMMENDATION"));
    });

    it("clinical statuses without a DOCTOR origin render as unverified (legacy rows)", () => {
      assert.strictEqual(displayRecommendationStatus("DOCTOR_RECOMMENDATION", "USER_NOTE"), "UNVERIFIED_CLINICAL");
      assert.strictEqual(displayRecommendationStatus("CONFIRMED", undefined), "UNVERIFIED_CLINICAL");
      assert.strictEqual(displayRecommendationStatus("DOCTOR_RECOMMENDATION", "DOCTOR"), "DOCTOR_RECOMMENDATION");
      assert.strictEqual(displayRecommendationStatus("AI_SUGGESTION", "AI_AGENT"), "AI_SUGGESTION");
    });

    it("REST: POST only accepts user-assignable statuses, PUT enforces the transition policy", () => {
      assert.match(read("src/app/api/recommendations/route.ts"), /status: z\.enum\(USER_ASSIGNABLE_RECOMMENDATION_STATUSES\)/);
      assert.match(read("src/app/api/recommendations/[id]/route.ts"), /isManualRecommendationStatusAllowed\(status, existing\.sourceType, existing\.status\)/);
    });

    it("UI: the edit form no longer offers clinical statuses and the badge receives the origin", () => {
      const page = read("src/app/recommendations/page.tsx");
      assert.doesNotMatch(page, /<option value="DOCTOR_RECOMMENDATION">/);
      assert.doesNotMatch(page, /<option value="CONFIRMED">/);
      assert.match(page, /<SafetyBadge status=\{rec\.status\} sourceType=\{rec\.sourceType\} \/>/);
    });
  });

  describe("4. Automatic protocol update only targets the nutrition protocol", () => {
    const pharma = { id: "pharma", notes: "## Protocolo farmacológico\n- Semaglutida 1 mg" };
    const nutrition = { id: "nutri", notes: `Resumo\n\n${CURRENT_PLAN_HEADING}\n\n- **Calorias:** 2000 kcal` };

    it("a pharmacological protocol from the same conversation is never a target", () => {
      assert.strictEqual(selectNutritionProtocolTarget([pharma]), null);
    });

    it("the single nutrition protocol is the target", () => {
      assert.strictEqual(selectNutritionProtocolTarget([pharma, nutrition])?.id, "nutri");
    });

    it("several nutrition protocols are ambiguous → no target (create new)", () => {
      assert.strictEqual(selectNutritionProtocolTarget([nutrition, { ...nutrition, id: "nutri-2" }]), null);
    });

    it("chat route filters candidates structurally and uses the selector", () => {
      const src = read("src/app/api/ai/chat/route.ts");
      assert.match(src, /notes: \{ contains: CURRENT_PLAN_HEADING \}/);
      assert.match(src, /selectNutritionProtocolTarget\(candidateRecommendations\)/);
    });
  });
});
