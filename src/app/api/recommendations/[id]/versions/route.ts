import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { computeMedicationVersionDiff, computeNutritionDiff } from "@/lib/diff";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const recommendation = await db.recommendation.findFirst({
    where: { id: params.id, userId: user!.userId },
    select: { id: true, title: true },
  });

  if (!recommendation) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  const versions = await db.recommendationVersion.findMany({
    where: { recommendationId: params.id },
    orderBy: { versionNumber: "asc" },
  });

  // Calculate diff between each version and its immediate predecessor
  const enrichedVersions = versions.map((ver, idx) => {
    if (idx === 0) {
      return {
        ...ver,
        diff: null,
        isInitial: true,
      };
    }

    const prevVer = versions[idx - 1];
    const prevSnap = (prevVer.summarySnapshot as any) || {};
    const currSnap = (ver.summarySnapshot as any) || {};

    const medDiffs = computeMedicationVersionDiff(
      prevSnap.medications || [],
      currSnap.medications || []
    );

    const nutrDiffs = computeNutritionDiff(
      prevSnap.nutrition || {},
      currSnap.nutrition || {}
    );

    return {
      ...ver,
      isInitial: false,
      diff: {
        medications: medDiffs,
        nutrition: nutrDiffs,
      },
    };
  });

  return NextResponse.json({
    recommendationTitle: recommendation.title,
    versions: enrichedVersions.reverse(), // Show newest first
  });
}
