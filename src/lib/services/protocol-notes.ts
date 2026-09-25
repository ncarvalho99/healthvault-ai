/**
 * Keeps a single "current nutrition plan" section inside a recommendation's Markdown notes,
 * so each automatic protocol version shows the plan that was actually saved.
 */

export const CURRENT_PLAN_HEADING = "## Plano nutricional vigente";

export interface SavedPlanSummary {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  reason?: string;
  referenceWeightKg?: number | null;
  savedAt: Date;
}

/**
 * Extracts the plan targets from a diet tool call's arguments (create_diet / update_diet share field names).
 */
export function planFromDietArgs(args: any, referenceWeightKg: number | null, savedAt = new Date()): SavedPlanSummary {
  const num = (v: any) => (typeof v === "number" && isFinite(v) ? v : undefined);
  return {
    calories: num(args?.target_calories),
    proteinG: num(args?.target_protein_g),
    carbsG: num(args?.target_carbs_g),
    fatG: num(args?.target_fat_g),
    reason: typeof args?.reason === "string" && args.reason.trim() ? args.reason.trim() : undefined,
    referenceWeightKg,
    savedAt,
  };
}

export function renderCurrentPlanSection(plan: SavedPlanSummary): string {
  const date = plan.savedAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const lines = [`${CURRENT_PLAN_HEADING}`, "", `*Atualizado em ${date}*`, ""];
  if (plan.calories !== undefined) lines.push(`- **Calorias:** ${plan.calories} kcal`);
  const macros = [
    plan.proteinG !== undefined ? `P ${plan.proteinG} g` : null,
    plan.carbsG !== undefined ? `C ${plan.carbsG} g` : null,
    plan.fatG !== undefined ? `G ${plan.fatG} g` : null,
  ].filter(Boolean);
  if (macros.length > 0) lines.push(`- **Macros:** ${macros.join(" · ")}`);
  if (typeof plan.referenceWeightKg === "number") lines.push(`- **Peso de referência:** ${plan.referenceWeightKg} kg`);
  if (plan.reason) lines.push(`- **Motivo:** ${plan.reason}`);
  return lines.join("\n");
}

/**
 * Replaces the existing current-plan section (up to the next "## " heading) or appends it.
 */
export function upsertCurrentPlanSection(notes: string | null | undefined, plan: SavedPlanSummary): string {
  const section = renderCurrentPlanSection(plan);
  const base = (notes || "").replace(/\r\n/g, "\n").trimEnd();
  const start = base.indexOf(CURRENT_PLAN_HEADING);
  if (start === -1) return base ? `${base}\n\n${section}` : section;

  const afterHeading = start + CURRENT_PLAN_HEADING.length;
  const nextHeading = base.slice(afterHeading).search(/\n## /);
  const end = nextHeading === -1 ? base.length : afterHeading + nextHeading;
  const rest = base.slice(end).replace(/^\n+/, "");
  return [base.slice(0, start).trimEnd(), section, rest].filter(Boolean).join("\n\n");
}
