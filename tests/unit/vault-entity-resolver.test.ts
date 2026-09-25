import { describe, it } from "node:test";
import assert from "node:assert";
import { VaultEntityResolver } from "../../src/lib/ai/research/vault-entity-resolver";
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

  it("should detect multiple active medications and formulate queries for all without silent omission", async () => {
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
        ],
      },
      dietPlan: { findFirst: async () => null },
    };

    const result = await VaultEntityResolver.resolve({
      userId: "user-test-2",
      userMessage: "Meu medicamento atual possui alguma interação conhecida com metformina?",
      intent: "MIXED",
      externalEntities: ["metformin"],
      dbClient: mockDb,
    });

    assert.strictEqual(result.used, true);
    assert.strictEqual(result.hasAmbiguity, true);
    assert.strictEqual(result.ambiguityType, "MULTIPLE_ACTIVE_MEDICATIONS");
    assert.deepStrictEqual(result.ambiguousItems, ["Ozempic", "Lipitor"]);
    assert.strictEqual(result.resolvedEntityCount, 2);

    // Ensure BOTH medications are present in formulated queries
    const hasSemaglutide = result.suggestedQueries.some((q) => q.includes("semaglutide"));
    const hasAtorvastatin = result.suggestedQueries.some((q) => q.includes("atorvastatin"));
    assert.strictEqual(hasSemaglutide, true, "Must include semaglutide in queries");
    assert.strictEqual(hasAtorvastatin, true, "Must include atorvastatin in queries (no silent omission)");
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
