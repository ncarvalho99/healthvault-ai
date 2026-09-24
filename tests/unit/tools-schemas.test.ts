import { describe, it } from "node:test";
import assert from "node:assert";
import * as schemas from "../../src/lib/ai/tools/schemas";

describe("HealthVault AI Tools Schemas Validation", () => {
  it("should validate medication update arguments", () => {
    const validArgs = {
      medication_id: "semaglutide-uuid-123",
      dose_value: 0.5,
      dose_unit: "mg",
      frequency: "1x/semana",
      reason: "Semana 5 titulação padrão",
      information_origin: "AI_SUGGESTED",
    };

    const res = schemas.updateMedicationSchema.safeParse(validArgs);
    assert.strictEqual(res.success, true);
  });

  it("should reject negative or zero doses", () => {
    const invalidArgs = {
      medication_id: "semaglutide-uuid-123",
      dose_value: -0.25,
      reason: "Ajuste",
    };

    const res = schemas.updateMedicationSchema.safeParse(invalidArgs);
    assert.strictEqual(res.success, false);
  });

  it("should reject changes without a clinical reason (audit violation)", () => {
    const missingReason = {
      medication_id: "med-1",
      dose_value: 10,
      reason: "", // empty reason
    };

    const res = schemas.updateMedicationSchema.safeParse(missingReason);
    assert.strictEqual(res.success, false);
  });

  it("should validate diet update arguments", () => {
    const validDiet = {
      target_calories: 2200,
      target_protein_g: 195,
      target_carbs_g: 190,
      target_fat_g: 65,
      reason: "Ajuste para recuperação muscular",
    };

    const res = schemas.updateDietSchema.safeParse(validDiet);
    assert.strictEqual(res.success, true);
  });

  it("should validate symptom logging with severity scale 1-10", () => {
    const validSymptom = {
      symptom: "Leve náusea",
      severity: 3,
      possible_trigger: "Pós injeção",
    };
    assert.strictEqual(schemas.addSymptomSchema.safeParse(validSymptom).success, true);

    const invalidSeverity = {
      symptom: "Dor extrema",
      severity: 15, // Out of bounds
    };
    assert.strictEqual(schemas.addSymptomSchema.safeParse(invalidSeverity).success, false);
  });
});
