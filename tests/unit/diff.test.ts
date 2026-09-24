import { describe, it } from "node:test";
import assert from "node:assert";
import { computeNutritionDiff, computeMedicationVersionDiff } from "../../src/lib/diff";

describe("Clinical Diff Calculator", () => {
  it("should accurately compute nutritional deltas between two versions", () => {
    const v1 = { targetCalories: 2300, targetProteinG: 180, targetCarbsG: 220, targetFatG: 75 };
    const v2 = { targetCalories: 2100, targetProteinG: 195, targetCarbsG: 180, targetFatG: 65 };

    const diffs = computeNutritionDiff(v1, v2);

    const calDiff = diffs.find((d) => d.field === "targetCalories");
    assert.ok(calDiff);
    assert.strictEqual(calDiff.delta, -200);
    assert.strictEqual(calDiff.oldValue, "2300 kcal");
    assert.strictEqual(calDiff.newValue, "2100 kcal");

    const proteinDiff = diffs.find((d) => d.field === "targetProteinG");
    assert.ok(proteinDiff);
    assert.strictEqual(proteinDiff.delta, 15);
    assert.strictEqual(proteinDiff.oldValue, "180 g");
    assert.strictEqual(proteinDiff.newValue, "195 g");
  });

  it("should detect medication dosage adjustments", () => {
    const oldMeds = [
      { name: "Semaglutide", dose: "0.25", doseUnit: "mg", frequency: "1x/week" },
    ];
    const newMeds = [
      { name: "Semaglutide", dose: "0.5", doseUnit: "mg", frequency: "1x/week" },
    ];

    const diff = computeMedicationVersionDiff(oldMeds, newMeds);
    assert.strictEqual(diff.length, 1);
    assert.strictEqual(diff[0].name, "Semaglutide");
    assert.strictEqual(diff[0].status, "adjusted");

    const doseChange = diff[0].changes.find((c) => c.field === "dose");
    assert.ok(doseChange);
    assert.strictEqual(doseChange.oldValue, "0.25 mg");
    assert.strictEqual(doseChange.newValue, "0.5 mg");
  });

  it("should detect newly added and discontinued medications", () => {
    const oldMeds = [
      { name: "Metformin", dose: "500", doseUnit: "mg", frequency: "2x/day" },
    ];
    const newMeds = [
      { name: "Semaglutide", dose: "0.25", doseUnit: "mg", frequency: "1x/week" },
    ];

    const diff = computeMedicationVersionDiff(oldMeds, newMeds);
    assert.strictEqual(diff.length, 2);

    const added = diff.find((d) => d.name === "Semaglutide");
    assert.ok(added);
    assert.strictEqual(added.status, "added");

    const removed = diff.find((d) => d.name === "Metformin");
    assert.ok(removed);
    assert.strictEqual(removed.status, "removed");
  });
});
