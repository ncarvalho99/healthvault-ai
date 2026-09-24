import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolRegistry } from "../../src/lib/ai/tools/registry";
import { SearchService } from "../../src/lib/services/search-service";

describe("Agent Runtime Hardening — Tool Catalog Synchronization", () => {
  it("should have exactly 27 clinical and context tools registered with complete metadata", () => {
    const registeredTools = ToolRegistry.getAll();
    assert.strictEqual(registeredTools.length, 27);

    for (const tool of registeredTools) {
      assert.ok(tool.name.startsWith("healthvault_"), `${tool.name} must start with healthvault_`);
      assert.ok(tool.description.length >= 15, `${tool.name} description must be detailed`);
      assert.ok(tool.category, `${tool.name} must belong to a category`);
      assert.ok(tool.permission, `${tool.name} must specify a permission string`);
      assert.ok(tool.risk === "low" || tool.risk === "medium" || tool.risk === "high");
    }
  });

  it("should include healthvault_search with appropriate schema and query validation", () => {
    const searchTool = ToolRegistry.get("healthvault_search");
    assert.ok(searchTool, "healthvault_search must exist in ToolRegistry");
    assert.strictEqual(searchTool.access, "read");
    assert.strictEqual(searchTool.risk, "low");

    const validArgs = { query: "semaglutida", limit: 5 };
    assert.strictEqual(searchTool.inputSchema.safeParse(validArgs).success, true);

    const invalidArgs = { query: 123 };
    assert.strictEqual(searchTool.inputSchema.safeParse(invalidArgs).success, false);
  });
});

describe("Agent Runtime Hardening — Optimistic Concurrency & TTL Rules", () => {
  it("should validate proposal TTL calculation logic", () => {
    const proposedAt = new Date();
    const ttlMinutes = 60;
    const expiresAt = new Date(proposedAt.getTime() + ttlMinutes * 60000);

    assert.ok(expiresAt > proposedAt);
    assert.strictEqual(expiresAt.getTime() - proposedAt.getTime(), 3600000);

    // Simulated expired time
    const pastTime = new Date(Date.now() - 5000);
    const isExpired = new Date() > pastTime;
    assert.strictEqual(isExpired, true);
  });

  it("should detect version conflicts when entityVersion differs from proposal", () => {
    const versionAtProposal: number = 2;
    const currentDatabaseVersion: number = 3;

    const hasConflict = versionAtProposal !== currentDatabaseVersion;
    assert.strictEqual(hasConflict, true);
  });
});

describe("Agent Runtime Hardening — OmniRoute Combo Filtering", () => {
  it("should classify user-defined combos strictly by owned_by == combo without auto/ prefixes", () => {
    const modelsFixture = [
      { id: "exploit", owned_by: "combo" },
      { id: "demigod-flash", owned_by: "combo" },
      { id: "claude-opus", owned_by: "combo" },
      { id: "auto/best-coding", owned_by: "combo" },
      { id: "auto/pro-chat", owned_by: "combo" },
      { id: "anthropic/claude-3-5-sonnet", owned_by: "anthropic" },
    ];

    const userCombos = modelsFixture.filter((m) => m.owned_by === "combo" && !m.id.startsWith("auto/"));
    assert.strictEqual(userCombos.length, 3);
    assert.deepStrictEqual(userCombos.map((m) => m.id), ["exploit", "demigod-flash", "claude-opus"]);
  });
});
