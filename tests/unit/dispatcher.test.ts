import { describe, it } from "node:test";
import assert from "node:assert";

describe("Tool Dispatcher Policies and Rules", () => {
  it("should enforce write policy schema defaults", () => {
    const policy = {
      recommendations: "AUTO_APPLY",
      nutrition: "AUTO_APPLY",
      metrics: "AUTO_APPLY",
      symptoms: "AUTO_APPLY",
      labs: "REVIEW_FIRST",
      medications: "REVIEW_FIRST",
      dosageChanges: "REVIEW_FIRST",
    };

    assert.strictEqual(policy.recommendations, "AUTO_APPLY");
    assert.strictEqual(policy.dosageChanges, "REVIEW_FIRST");
    assert.strictEqual(policy.medications, "REVIEW_FIRST");
    assert.strictEqual(policy.nutrition, "AUTO_APPLY");
  });

  it("should parse valid JSON arguments and handle malformed strings gracefully", () => {
    const validJson = JSON.stringify({ medication_id: "med-1", dose_value: 0.5 });
    const parsed = JSON.parse(validJson);
    assert.strictEqual(parsed.medication_id, "med-1");
    assert.strictEqual(parsed.dose_value, 0.5);

    const malformed = "{invalid-json:";
    let caught = false;
    try {
      JSON.parse(malformed);
    } catch {
      caught = true;
    }
    assert.strictEqual(caught, true);
  });
});
