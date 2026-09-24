import { PrismaClient } from "@prisma/client";
import { ReasoningFilter } from "../src/lib/ai/response/reasoning-filter";
import { MarkdownNormalizer } from "../src/lib/ai/response/markdown-normalizer";

const prisma = new PrismaClient();

async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(`=== HealthVault AI Message Reasoning Cleaner (${isApply ? "APPLY MODE" : "DRY RUN"}) ===\n`);

  // Find all AI messages
  const aiMessages = await prisma.message.findMany({
    where: { senderType: "AI" },
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
  });

  let contaminatedCount = 0;
  let cleanedCount = 0;

  for (const msg of aiMessages) {
    const hasTag = /<(think|thinking|reasoning)>[\s\S]*?/i.test(msg.content);
    if (!hasTag) continue;

    contaminatedCount++;
    const { cleanText } = ReasoningFilter.filterThinkingTags(msg.content);
    const normalized = MarkdownNormalizer.normalize(cleanText);

    console.log(`[FOUND] Message ID: ${msg.id} (Conversation: ${msg.conversationId})`);
    console.log(`  Original length: ${msg.content.length} chars | Cleaned length: ${normalized.length} chars`);
    console.log(`  Sample cleaned preview: "${normalized.slice(0, 100)}..."\n`);

    if (isApply) {
      const nextVer = msg.versions.length > 0 ? msg.versions[0].versionNumber + 1 : 1;

      await prisma.$transaction([
        // Archive original content in MessageVersion
        prisma.messageVersion.create({
          data: {
            messageId: msg.id,
            versionNumber: nextVer,
            content: msg.content,
            editedBy: "System (Reasoning Cleanup Script)",
            reason: "Remoção de vazamento de reasoning/thinking tags",
          },
        }),
        // Update message with clean content
        prisma.message.update({
          where: { id: msg.id },
          data: {
            content: normalized,
            isEdited: true,
          },
        }),
      ]);
      cleanedCount++;
    }
  }

  console.log(`----------------------------------------`);
  console.log(`Total AI messages scanned: ${aiMessages.length}`);
  console.log(`Contaminated messages found: ${contaminatedCount}`);
  if (isApply) {
    console.log(`Successfully cleaned and versioned: ${cleanedCount}`);
  } else {
    console.log(`(Dry run complete. Run with --apply to commit cleanup and version history.)`);
  }
}

main()
  .catch((e) => {
    console.error("Error running cleanup:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
