import { describe, it } from "node:test";
import assert from "node:assert";
import { VaultEntityResolver } from "../../src/lib/ai/research/vault-entity-resolver";
import { ResearchIntentAnalyzer } from "../../src/lib/ai/research/research-intent";
import { QuerySanitizer } from "../../src/lib/ai/research/query-sanitizer";

describe("Vault Entity Resolver — Server-Side Minimal Resolution", () => {
  it("should resolve single active medication from Vault and generate targeted interaction queries", async () => {
    const mockDb = {
      medication: {
        findMany: async () => [
          {
            id: "med-1",
            name: "Ozempic",
            genericName: "semaglutida",
            isActive: true,
            versions: [{ doseValue: 0.5, doseUnit: "mg", versionNumber: 1 }],
          },
        ],
      },
      dietPlan: { findFirst: async () => null },
    };

    const result = await VaultEntityResolver.resolve({
      userId: "user-test-1",
      userMessage: "Meu medicamento atual possui alguma interação conhecida com metformina?",
      intent: "MIXED",
      externalEntities: ["metformin"],
      dbClient: mockDb,
    });

    assert.strictEqual(result.used, true);
    assert.strictEqual(result.status, "RESOLVED");
    assert.strictEqual(result.resolvedEntityCount, 1);
    assert.deepStrictEqual(result.resolvedEntityTypes, ["medication"]);
    assert.strictEqual(result.hasAmbiguity, false);
    assert.strictEqual(result.resolvedEntities[0].name, "semaglutide");
    assert.strictEqual(result.resolvedEntities[0].dose, "0.5 mg");

    // Validate suggested interaction query
    const hasInteractionQuery = result.suggestedQueries.some(
      (q) => q.includes("semaglutide") && q.includes("metformin") && q.includes("interaction")
    );
    assert.strictEqual(hasInteractionQuery, true, "Should produce query combining semaglutide, metformin and interaction");

    // Validate regulatory domain-targeted query
    const hasFdaQuery = result.domainTargetedQueries.some(
      (q) => q.includes("site:fda.gov") && q.includes("semaglutide") && q.includes("metformin")
    );
    assert.strictEqual(hasFdaQuery, true, "Should produce targeted query for site:fda.gov semaglutide metformin");

    const hasPubmedQuery = result.domainTargetedQueries.some(
      (q) => q.includes("site:pubmed.ncbi.nlm.nih.gov") && q.includes("semaglutide") && q.includes("metformin")
    );
    assert.strictEqual(hasPubmedQuery, true, "Should produce targeted query for site:pubmed.ncbi.nlm.nih.gov");
  });

  it("should return state NEEDS_DISAMBIGUATION without slice omission when user has 4 active medications", async () => {
    // 4 active medications in Vault
    const mockDb = {
      medication: {
        findMany: async () => [
          {
            id: "med-1",
            name: "Ozempic",
            genericName: "semaglutida",
            isActive: true,
            versions: [{ doseValue: 0.5, doseUnit: "mg", versionNumber: 1 }],
          },
          {
            id: "med-2",
            name: "Lipitor",
            genericName: "atorvastatina",
            isActive: true,
            versions: [{ doseValue: 20, doseUnit: "mg", versionNumber: 1 }],
          },
          {
            id: "med-3",
            name: "Glifage",
            genericName: "metformina",
            isActive: true,
            versions: [{ doseValue: 500, doseUnit: "mg", versionNumber: 1 }],
          },
          {
            id: "med-4",
            name: "Losartana",
            genericName: "losartana potassica",
            isActive: true,
            versions: [{ doseValue: 50, doseUnit: "mg", versionNumber: 1 }],
          },
        ],
      },
      dietPlan: { findFirst: async () => null },
    };

    const result = await VaultEntityResolver.resolve({
      userId: "user-test-4meds",
      userMessage: "Meu medicamento atual possui alguma interação conhecida com metformina?",
      intent: "MIXED",
      externalEntities: ["metformin"],
      dbClient: mockDb,
    });

    assert.strictEqual(result.used, true);
    assert.strictEqual(result.status, "NEEDS_DISAMBIGUATION");
    assert.strictEqual(result.hasAmbiguity, true);
    assert.strictEqual(result.ambiguityType, "NEEDS_DISAMBIGUATION");
    assert.strictEqual(result.resolvedEntityCount, 4);

    // CRITICAL: Ensure ALL 4 medications are preserved in ambiguousItems with NO slice(0,3) omission!
    assert.strictEqual(result.ambiguousItems?.length, 4);
    assert.deepStrictEqual(result.ambiguousItems, ["Ozempic", "Lipitor", "Glifage", "Losartana"]);

    // CRITICAL: Must not formulate specific searches until user chooses
    assert.strictEqual(result.suggestedQueries.length, 0);
    assert.strictEqual(result.domainTargetedQueries.length, 0);
  });

  it("should recognize clinical safety patterns for 'interacoes' without accent and 'interações' plural", () => {
    // 1. "interacoes" sem acento
    const resNoAccent = ResearchIntentAnalyzer.analyze("Quais são as interacoes conhecidas desse medicamento?");
    assert.strictEqual(resNoAccent.isClinicalSafetyQuery, true, "'interacoes' sem acento must set isClinicalSafetyQuery=true");

    // 2. "interações" plural com acento
    const resPlural = ResearchIntentAnalyzer.analyze("Quais são as interações deste composto?");
    assert.strictEqual(resPlural.isClinicalSafetyQuery, true, "'interações' plural must set isClinicalSafetyQuery=true");

    // 3. contraindicação / contraindicações / contraindicacao / contraindicacoes
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Tem contraindicações?").isClinicalSafetyQuery, true);
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Tem contraindicacao?").isClinicalSafetyQuery, true);

    // 4. efeito adverso / efeitos adversos
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Quais os efeitos adversos?").isClinicalSafetyQuery, true);
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Qual o efeito adverso?").isClinicalSafetyQuery, true);

    // 5. segurança / seguranca
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Qual a seguranca do uso prolongado?").isClinicalSafetyQuery, true);
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Qual a segurança do uso?").isClinicalSafetyQuery, true);

    // 6. toxicidade / dose / dosagem / titulação
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Qual o risco de toxicidade?").isClinicalSafetyQuery, true);
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Qual a dose recomendada?").isClinicalSafetyQuery, true);
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Como é a titulação da dose?").isClinicalSafetyQuery, true);
    assert.strictEqual(ResearchIntentAnalyzer.analyze("Como funciona a titulacao?").isClinicalSafetyQuery, true);
  });

  it("should resolve diet reference when user mentions current diet in a mixed question", async () => {
    const mockDb = {
      medication: { findMany: async () => [] },
      dietPlan: {
        findFirst: async () => ({
          id: "diet-1",
          title: "Low Carb Cetogênica",
          isActive: true,
          versions: [{ targetCalories: 1800, versionNumber: 1 }],
        }),
      },
    };

    const result = await VaultEntityResolver.resolve({
      userId: "user-test-3",
      userMessage: "Minha dieta atual tem algum risco se combinada com metformina?",
      intent: "MIXED",
      externalEntities: ["metformin"],
      dbClient: mockDb,
    });

    assert.strictEqual(result.used, true);
    assert.strictEqual(result.resolvedEntities[0].type, "diet");
    assert.strictEqual(result.resolvedEntities[0].name, "low carb cetogênica");
    assert.ok(result.suggestedQueries.some((q) => q.includes("metformin")));
  });

  it("should maintain strict privacy and never leak user ID or personal narratives in queries", async () => {
    const mockDb = {
      medication: {
        findMany: async () => [
          {
            id: "med-private-1234-uuid",
            name: "Ozempic",
            genericName: "semaglutida",
            isActive: true,
            versions: [{ doseValue: 0.5, doseUnit: "mg", versionNumber: 1 }],
          },
        ],
      },
      dietPlan: { findFirst: async () => null },
    };

    const result = await VaultEntityResolver.resolve({
      userId: "user-sensitive-uuid-9999",
      userMessage: "Eu me chamo João da Silva, moro na Rua das Flores 123. Meu medicamento atual tem interação com metformina?",
      intent: "MIXED",
      externalEntities: ["metformin"],
      dbClient: mockDb,
    });

    const allQueries = [...result.suggestedQueries, ...result.domainTargetedQueries];
    for (const q of allQueries) {
      assert.strictEqual(/joão|silva|rua das flores|user-sensitive|med-private/i.test(q), false, `Query '${q}' must not leak PII`);
    }
  });

  it("should skip resolution when intent is not MIXED or userId is missing", async () => {
    const mockDb = {
      medication: { findMany: async () => [{ id: "1", name: "semaglutida" }] },
    };

    const noUserResult = await VaultEntityResolver.resolve({
      userMessage: "Meu medicamento tem interação com metformina?",
      intent: "MIXED",
      dbClient: mockDb,
    });
    assert.strictEqual(noUserResult.used, false);

    const localOnlyResult = await VaultEntityResolver.resolve({
      userId: "user-1",
      userMessage: "Qual é meu medicamento atual?",
      intent: "LOCAL_VAULT_ONLY",
      dbClient: mockDb,
    });
    assert.strictEqual(localOnlyResult.used, false);
  });
});
