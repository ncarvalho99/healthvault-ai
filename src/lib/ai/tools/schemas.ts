import { z } from "zod";

export const getContextSchema = z.object({
  include: z.array(z.enum(["medications", "diet", "recommendations", "metrics", "symptoms", "labs"])),
});

export const listMedicationsSchema = z.object({
  active_only: z.boolean().optional().default(true),
});

export const createMedicationSchema = z.object({
  name: z.string().min(1),
  generic_name: z.string().optional(),
  category: z.string().optional(),
  form: z.string().optional(),
  dose_value: z.number().positive(),
  dose_unit: z.string().min(1),
  frequency: z.string().min(1),
  schedule: z.string().optional(),
  reason: z.string().min(1),
  information_origin: z.enum(["USER_REPORTED", "AI_SUGGESTED", "PROFESSIONAL_REPORTED"]).optional().default("AI_SUGGESTED"),
});

export const updateMedicationSchema = z.object({
  medication_id: z.string().min(1),
  dose_value: z.number().positive(),
  dose_unit: z.string().optional(),
  frequency: z.string().optional(),
  schedule: z.string().optional(),
  reason: z.string().min(1),
  information_origin: z.enum(["USER_REPORTED", "AI_SUGGESTED", "PROFESSIONAL_REPORTED"]).optional().default("AI_SUGGESTED"),
});

export const stopMedicationSchema = z.object({
  medication_id: z.string().min(1),
  reason: z.string().min(1),
});

export const updateDietSchema = z.object({
  target_calories: z.number().positive(),
  target_protein_g: z.number().positive(),
  target_carbs_g: z.number().positive(),
  target_fat_g: z.number().positive(),
  reason: z.string().min(1),
  information_origin: z.enum(["USER_REPORTED", "AI_SUGGESTED", "PROFESSIONAL_REPORTED"]).optional().default("AI_SUGGESTED"),
});

export const createRecommendationSchema = z.object({
  title: z.string().min(1),
  notes: z.string().min(1),
  reason: z.string().optional(),
});

export const addBodyMetricSchema = z.object({
  weight_kg: z.number().positive(),
  body_fat_pct: z.number().min(0).max(100).optional(),
  waist_cm: z.number().positive().optional(),
  notes: z.string().optional(),
});

export const addSymptomSchema = z.object({
  symptom: z.string().min(1),
  severity: z.number().int().min(1).max(10),
  possible_trigger: z.string().optional(),
  description: z.string().optional(),
});

export const addLabResultSchema = z.object({
  test_name: z.string().min(1),
  marker_name: z.string().min(1),
  result_value: z.number(),
  unit: z.string().min(1),
  reference_range_low: z.number().optional(),
  reference_range_high: z.number().optional(),
});

export const createReminderSchema = z.object({
  title: z.string().min(1),
  due_date: z.string().min(1),
  notes: z.string().optional(),
});
