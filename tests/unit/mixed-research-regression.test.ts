import { describe, it } from "node:test";
import assert from "node:assert";
import { ResearchOrchestrator } from "../../src/lib/ai/research/research-orchestrator";
import { SearchResult, WebResearchProvider } from "../../src/lib/ai/research/types";

describe("MIXED Web-First Research — End-to-End Query Formulation Regression", () => {
  it("should deliver real queries containing resolved active medication (semaglutide) and external drug (metformin) to search providers", async () => {
    // Vault mock with semaglutide 0.5 mg active
    const mockDb = {
      medication: {
        findMany: async () => [
          {
            id: "med-active-semaglutide",
            name: "Ozempic",
            genericName: "semaglutida",
            isActive: true,
            versions: [{ doseValue: 0.5, doseUnit: "mg", versionNumber: 1 }],
          },
        ],
      },
      dietPlan: { findFirst: async () => null },
    };

    // Mock search provider that intercepts queries delivered to external search
    const deliveredQueries: string[] = [];
    class MockSpySearchProvider implements WebResearchProvider {
      name = "mock-spy-provider";
      async search(query: string): Promise<SearchResult[]> {
        deliveredQueries.push(query);
        return [
          {
            id: "S1",
            title: "Semaglutide and Metformin Drug Interaction Profile",
            url: "https://www.fda.gov/drugs/postmarket-drug-safety-information/semaglutide-metformin",
            snippet: "Clinical studies demonstrate safe co-administration of semaglutide and metformin with no pharmacokinetic interaction.",
            sourceDomain: "fda.gov",
            tier: 1,
            isAnecdotal: false,
            retrievedAt: new Date().toISOString(),
          },
          {
            id: "S2",
            title: "Co-administration of GLP-1 receptor agonists and metformin",
            url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
            snippet: "Evidence from randomised controlled trials on concomitant use of semaglutide and metformin.",
            sourceDomain: "pubmed.ncbi.nlm.nih.gov",
            tier: 1,
            isAnecdotal: false,
            retrievedAt: new Date().toISOString(),
          },
        ];
      }
      async healthCheck() {
        return { ok: true, provider: "mock-spy-provider" };
      }
    }

    const spyProvider = new MockSpySearchProvider();
    const origGetChain = ResearchOrchestrator.getProviderChain;
    ResearchOrchestrator.getProviderChain = () => [spyProvider];

    try {
      const result = await ResearchOrchestrator.execute({
        userId: "user-reg-1",
        userMessage: "Meu medicamento atual possui alguma interação conhecida com metformina?",
        modelId: "exploit", // Web-first REQUIRED
        dbClient: mockDb,
      });

      // 1. Verify general execution status and classification
      assert.strictEqual(result.intent, "MIXED");
      assert.strictEqual(result.status, "SUCCESS");
      assert.strictEqual(result.vaultResolutionUsed, true);
      assert.strictEqual(result.resolvedEntityCount, 1);
      assert.deepStrictEqual(result.resolvedEntityTypes, ["medication"]);
      assert.ok(result.sources.length >= 1, "Must return at least 1 authoritative source");

      // 2. Validate that queries were delivered to the external search provider
      assert.ok(deliveredQueries.length > 0, "External search provider must have received queries");

      // 3. Mandatory: validate that at least one query contains semaglutide + metformin + interaction
      const hasClinicalInteractionQuery = deliveredQueries.some((q) => {
        const lower = q.toLowerCase();
        return (
          lower.includes("semaglutide") &&
          lower.includes("metformin") &&
          (lower.includes("interaction") || lower.includes("drug interaction"))
        );
      });
      assert.strictEqual(
        hasClinicalInteractionQuery,
        true,
        `Delivered queries [${deliveredQueries.join(" | ")}] must contain at least one query with 'semaglutide', 'metformin', and 'interaction'`
      );

      // 4. Mandatory: validate that at least one authority query contains site:fda.gov or site:pubmed.ncbi.nlm.nih.gov
      const hasAuthorityTargetedQuery = deliveredQueries.some((q) => {
        const lower = q.toLowerCase();
        return (
          (lower.includes("site:fda.gov") || lower.includes("site:pubmed.ncbi.nlm.nih.gov")) &&
          lower.includes("semaglutide") &&
          lower.includes("metformin")
        );
      });
      assert.strictEqual(
        hasAuthorityTargetedQuery,
        true,
        `Delivered queries [${deliveredQueries.join(" | ")}] must contain targeted authority query (site:fda.gov or site:pubmed with semaglutide and metformin)`
      );
    } finally {
      ResearchOrchestrator.getProviderChain = origGetChain;
    }
  });

  it("should NOT trigger external Web Research for strictly local vault queries", async () => {
    let searchProviderCalled = false;
    class MockSpySearchProvider implements WebResearchProvider {
      name = "mock-spy-provider";
      async search(): Promise<SearchResult[]> {
        searchProviderCalled = true;
        return [];
      }
      async healthCheck() {
        return { ok: true, provider: "mock-spy-provider" };
      }
    }

    const origGetChain = ResearchOrchestrator.getProviderChain;
    ResearchOrchestrator.getProviderChain = () => [new MockSpySearchProvider()];

    try {
      const result = await ResearchOrchestrator.execute({
        userId: "user-reg-2",
        userMessage: "Qual é meu medicamento atual?",
        modelId: "exploit",
      });

      assert.strictEqual(result.intent, "LOCAL_VAULT_ONLY");
      assert.strictEqual(result.status, "SKIPPED");
      assert.strictEqual(result.vaultResolutionUsed, false);
      assert.strictEqual(searchProviderCalled, false, "Local queries must not trigger external Web Research");
    } finally {
      ResearchOrchestrator.getProviderChain = origGetChain;
    }
  });
});
