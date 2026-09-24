import { PrismaClient, SenderType, RecommendationStatus, SourceType, ActorType, LabFlag } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding HealthVault AI database...");

  // 1. Create or upsert primary user
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || "HealthVault2026!ChangeMe";
  const passwordHash = await bcrypt.hash(initialPassword, 12);
  const user = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      email: "operator@healthvault.local",
      passwordHash,
      fullName: "HealthVault Operator",
      role: "ADMIN",
    },
  });

  console.log(`User created: ${user.username} (${user.id})`);

  // 2. Create sample conversation
  const conversation = await prisma.conversation.create({
    data: {
      userId: user.id,
      title: "Cutting Phase & Medication Protocol",
      tags: ["cutting", "metabolic", "semaglutide"],
      isFavorite: true,
      summary: "User started cutting protocol. Medication titrated from 0.25mg to 0.5mg weekly. Calories set to 2100 kcal with 190g protein.",
      summaryData: {
        currentGoal: "Body fat reduction with muscle preservation",
        activeMeds: ["Semaglutide 0.5mg/wk", "Omega-3 2000mg/d"],
        targetCalories: 2100,
        targetProteinG: 190,
      },
    },
  });

  // 3. Create conversation messages
  const msg1 = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: SenderType.USER,
      senderName: "User",
      content: "Olá! Comecei o protocolo de perda de gordura há 4 semanas com Semaglutida 0.25mg/semana. Os sintomas foram tranquilos, apenas leve náusea no segundo dia. Posso subir a dose para 0.5mg conforme o protocolo inicial?",
    },
  });

  const msg2 = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: SenderType.AI,
      senderName: "Health Assistant (Claude 3.5 Sonnet)",
      metadata: { model: "claude-3-5-sonnet", safetyLevel: "informational" },
      content: "Olá! Com base nas diretrizes padrão de titulação e na ausência de efeitos colaterais severos relatados nas primeiras 4 semanas:\n\n1. **Titulação de Semaglutida**: O avanço para **0.5 mg uma vez por semana** é a conduta padrão na 5ª semana.\n2. **Nutrição recomendada**: Manter ingestão proteica elevada (~190g/dia) para preservar massa magra e 2100 kcal diárias.\n3. **Atenção**: Mantenha hidratação constante e fracione as refeições para mitigar náuseas.\n\n*Nota: Esta é uma sugestão baseada em literatura; consulte seu médico responsável antes de qualquer alteração definitiva.*",
    },
  });

  // 4. Create recommendation with version 1 and version 2 (demonstrating versioning)
  const recommendation = await prisma.recommendation.create({
    data: {
      userId: user.id,
      conversationId: conversation.id,
      title: "Cutting Phase Protocol",
      status: RecommendationStatus.AI_SUGGESTION,
      sourceType: SourceType.AI_AGENT,
      sourceName: "Claude 3.5 Sonnet",
      aiModel: "claude-3-5-sonnet",
      notes: "Titration protocol from 0.25mg to 0.5mg. Review in 14 days.",
      currentVersion: 2,
    },
  });

  // Recommendation Version 1 (0.25 mg)
  await prisma.recommendationVersion.create({
    data: {
      recommendationId: recommendation.id,
      versionNumber: 1,
      status: RecommendationStatus.CONFIRMED,
      summarySnapshot: {
        medications: [{ name: "Semaglutide", dose: "0.25 mg", frequency: "1x/week" }],
        nutrition: { calories: 2300, protein_g: 180, carbs_g: 220, fat_g: 75 },
      },
      changeReason: "Initial baseline protocol",
      conversationId: conversation.id,
      actorType: ActorType.DOCTOR,
      actorName: "Dr. Clinician",
      createdAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000), // 28 days ago
    },
  });

  // Recommendation Version 2 (0.5 mg)
  await prisma.recommendationVersion.create({
    data: {
      recommendationId: recommendation.id,
      versionNumber: 2,
      status: RecommendationStatus.AI_SUGGESTION,
      summarySnapshot: {
        medications: [{ name: "Semaglutide", dose: "0.5 mg", frequency: "1x/week" }],
        nutrition: { calories: 2100, protein_g: 190, carbs_g: 190, fat_g: 65 },
      },
      changeReason: "Week 5 dose titration after review conversation",
      conversationId: conversation.id,
      actorType: ActorType.AI,
      actorName: "Claude 3.5 Sonnet",
      createdAt: new Date(),
    },
  });

  // 5. Create medication and versions
  const sema = await prisma.medication.create({
    data: {
      userId: user.id,
      recommendationId: recommendation.id,
      name: "Semaglutide",
      genericName: "Semaglutide",
      brandName: "Ozempic",
      category: "GLP-1 RA",
      form: "Subcutaneous Injection",
      isActive: true,
    },
  });

  await prisma.medicationVersion.create({
    data: {
      medicationId: sema.id,
      versionNumber: 1,
      doseValue: 0.25,
      doseUnit: "mg",
      frequency: "1x/week",
      schedule: "Sunday morning",
      route: "Subcutaneous",
      startDate: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
      endDate: new Date(),
      changeReason: "Initial initiation dose",
      conversationId: conversation.id,
      actorType: ActorType.DOCTOR,
      actorName: "Dr. Clinician",
      createdAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.medicationVersion.create({
    data: {
      medicationId: sema.id,
      versionNumber: 2,
      doseValue: 0.5,
      doseUnit: "mg",
      frequency: "1x/week",
      schedule: "Sunday morning",
      route: "Subcutaneous",
      startDate: new Date(),
      changeReason: "Standard week 5 dose escalation",
      conversationId: conversation.id,
      actorType: ActorType.AI,
      actorName: "Claude 3.5 Sonnet",
      createdAt: new Date(),
    },
  });

  // 6. Create Diet Plan and versions
  const diet = await prisma.dietPlan.create({
    data: {
      userId: user.id,
      title: "Lean Cut & High Protein",
      goal: "Fat loss with muscle retention",
      currentVersion: 2,
      isActive: true,
    },
  });

  await prisma.dietVersion.create({
    data: {
      dietPlanId: diet.id,
      versionNumber: 1,
      targetCalories: 2300,
      targetProteinG: 180,
      targetCarbsG: 220,
      targetFatG: 75,
      changeReason: "Baseline deficit",
      conversationId: conversation.id,
      createdAt: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
    },
  });

  const dietV2 = await prisma.dietVersion.create({
    data: {
      dietPlanId: diet.id,
      versionNumber: 2,
      targetCalories: 2100,
      targetProteinG: 190,
      targetCarbsG: 190,
      targetFatG: 65,
      changeReason: "Adjustment for increased fat oxidation rate",
      conversationId: conversation.id,
      createdAt: new Date(),
    },
  });

  // Create sample meal for diet
  const meal1 = await prisma.meal.create({
    data: {
      dietVersionId: dietV2.id,
      name: "Café da Manhã (Pre-workout)",
      scheduledTime: "07:30",
    },
  });

  const egg = await prisma.food.upsert({
    where: { name: "Ovo Inteiro" },
    update: {},
    create: {
      name: "Ovo Inteiro",
      caloriesPer100: 143,
      proteinPer100: 13,
      carbsPer100: 0.7,
      fatPer100: 9.5,
    },
  });

  await prisma.mealFood.create({
    data: {
      mealId: meal1.id,
      foodId: egg.id,
      portionG: 150,
    },
  });

  // 7. Body Metric
  await prisma.bodyMetric.create({
    data: {
      userId: user.id,
      date: new Date(),
      weightKg: 83.2,
      bodyFatPct: 15.8,
      muscleMassKg: 66.8,
      waistCm: 84.0,
      notes: "Steady drop from 85.5kg baseline.",
      conversationId: conversation.id,
    },
  });

  // 8. Symptom
  await prisma.symptom.create({
    data: {
      userId: user.id,
      symptom: "Leve Náusea",
      severity: 3,
      date: new Date(),
      description: "Leve desconforto gástrico 24h após injeção semanal.",
      medicationId: sema.id,
      conversationId: conversation.id,
    },
  });

  // 9. Lab Tests
  await prisma.labTest.create({
    data: {
      userId: user.id,
      testName: "Perfil Lipídico e Glicêmico",
      category: "Metabólico",
      testDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      markerName: "Glicemia de Jejum",
      resultValue: 88,
      unit: "mg/dL",
      referenceRangeLow: 70,
      referenceRangeHigh: 99,
      flag: LabFlag.NORMAL,
      conversationId: conversation.id,
    },
  });

  await prisma.labTest.create({
    data: {
      userId: user.id,
      testName: "Perfil Lipídico e Glicêmico",
      category: "Metabólico",
      testDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      markerName: "HbA1c",
      resultValue: 5.2,
      unit: "%",
      referenceRangeLow: 4.0,
      referenceRangeHigh: 5.6,
      flag: LabFlag.NORMAL,
      conversationId: conversation.id,
    },
  });

  // 10. Reminder
  await prisma.reminder.create({
    data: {
      userId: user.id,
      title: "Reavaliar tolerância da dose 0.5mg e peso",
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      notes: "Verificar se náusea persiste e confirmar dosagem.",
    },
  });

  // 11. Initial Audit Log
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "DATABASE_SEEDED",
      entity: "SYSTEM",
      entityId: "SYSTEM_INIT",
      ipAddress: "127.0.0.1",
      userAgent: "Seed Script v1.0",
      metadata: { status: "Success", initialUser: "admin" },
    },
  });

  console.log("Seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
