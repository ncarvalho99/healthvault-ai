export interface FieldDiff<T = any> {
  field: string;
  label: string;
  oldValue: T;
  newValue: T;
  type: "added" | "removed" | "modified" | "unchanged";
  delta?: number;
}

export interface MedicationDiff {
  name: string;
  changes: FieldDiff[];
  status: "added" | "removed" | "adjusted" | "unchanged";
}

export interface VersionDiffResult {
  versionA: number;
  versionB: number;
  medicationDiffs: MedicationDiff[];
  nutritionDiffs: FieldDiff[];
  reasonB?: string | null;
  actorB?: string | null;
  dateB?: string | Date;
}

export function computeNutritionDiff(
  oldNutr: { targetCalories?: number; targetProteinG?: number; targetCarbsG?: number; targetFatG?: number } = {},
  newNutr: { targetCalories?: number; targetProteinG?: number; targetCarbsG?: number; targetFatG?: number } = {}
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  const compareField = (field: string, label: string, oldVal?: number, newVal?: number, unit: string = "") => {
    if (oldVal !== undefined || newVal !== undefined) {
      const vOld = oldVal ?? 0;
      const vNew = newVal ?? 0;
      const delta = vNew - vOld;
      if (delta !== 0) {
        diffs.push({
          field,
          label,
          oldValue: `${vOld}${unit}`,
          newValue: `${vNew}${unit}`,
          type: oldVal === undefined ? "added" : newVal === undefined ? "removed" : "modified",
          delta,
        });
      }
    }
  };

  compareField("targetCalories", "Calorias", oldNutr.targetCalories, newNutr.targetCalories, " kcal");
  compareField("targetProteinG", "Proteína", oldNutr.targetProteinG, newNutr.targetProteinG, " g");
  compareField("targetCarbsG", "Carboidratos", oldNutr.targetCarbsG, newNutr.targetCarbsG, " g");
  compareField("targetFatG", "Gorduras", oldNutr.targetFatG, newNutr.targetFatG, " g");

  return diffs;
}

export function computeMedicationVersionDiff(
  oldMeds: Array<{ name: string; dose?: string | number; doseUnit?: string; frequency?: string; schedule?: string; [key: string]: any }> = [],
  newMeds: Array<{ name: string; dose?: string | number; doseUnit?: string; frequency?: string; schedule?: string; [key: string]: any }> = []
): MedicationDiff[] {
  const mapOld = new Map(oldMeds.map((m) => [m.name.toLowerCase().trim(), m]));
  const mapNew = new Map(newMeds.map((m) => [m.name.toLowerCase().trim(), m]));

  const allNames = Array.from(new Set([...mapOld.keys(), ...mapNew.keys()]));
  const results: MedicationDiff[] = [];

  for (const key of allNames) {
    const oldM = mapOld.get(key);
    const newM = mapNew.get(key);

    if (!oldM && newM) {
      results.push({
        name: newM.name,
        status: "added",
        changes: [
          {
            field: "dose",
            label: "Dose Inicial",
            oldValue: null,
            newValue: `${newM.dose ?? ""} ${newM.doseUnit ?? ""}`.trim(),
            type: "added",
          },
        ],
      });
    } else if (oldM && !newM) {
      results.push({
        name: oldM.name,
        status: "removed",
        changes: [
          {
            field: "status",
            label: "Uso",
            oldValue: "Ativo",
            newValue: "Descontinuado",
            type: "removed",
          },
        ],
      });
    } else if (oldM && newM) {
      const changes: FieldDiff[] = [];
      const oldDose = `${oldM.dose ?? ""} ${oldM.doseUnit ?? ""}`.trim();
      const newDose = `${newM.dose ?? ""} ${newM.doseUnit ?? ""}`.trim();

      if (oldDose !== newDose) {
        changes.push({
          field: "dose",
          label: "Dosagem",
          oldValue: oldDose,
          newValue: newDose,
          type: "modified",
        });
      }

      if (oldM.frequency !== newM.frequency) {
        changes.push({
          field: "frequency",
          label: "Frequência",
          oldValue: oldM.frequency,
          newValue: newM.frequency,
          type: "modified",
        });
      }

      if (oldM.schedule !== newM.schedule) {
        changes.push({
          field: "schedule",
          label: "Horário",
          oldValue: oldM.schedule,
          newValue: newM.schedule,
          type: "modified",
        });
      }

      results.push({
        name: newM.name,
        status: changes.length > 0 ? "adjusted" : "unchanged",
        changes,
      });
    }
  }

  return results;
}
