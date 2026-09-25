import { NextRequest, NextResponse } from "next/server";
import { canEditReleasePR, getCurrentUserEmail } from "@/lib/authz";
import { DEFAULT_REPO, prUrl } from "@/lib/bitbucket";
import {
  devQaTicketBranchPrefixes,
  extractDevQaTicketNumber,
} from "@/lib/branch-ticket";
import { findPatchMatchesFromFingerprints } from "@/lib/patch-score";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userEmail = await getCurrentUserEmail();

  if (!userEmail) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const releasePR = await prisma.releasePR.findUnique({
    where: { id },
    select: { author: true, sourceBranch: true, patchFingerprint: true },
  });

  if (!releasePR) {
    return NextResponse.json(
      { success: false, error: `Release PR #${id} not found` },
      { status: 404 }
    );
  }

  if (!(await canEditReleasePR(userEmail, releasePR.author))) {
    return NextResponse.json(
      { success: false, error: "You are not allowed to edit this PR" },
      { status: 403 }
    );
  }

  if (!releasePR.patchFingerprint) {
    return NextResponse.json(
      { success: false, error: "Patch fingerprint is not available for this release PR" },
      { status: 409 }
    );
  }

  if (!releasePR.sourceBranch) {
    return NextResponse.json(
      {
        success: false,
        error: "Source branch is not available. Run the refresh API to backfill it.",
      },
      { status: 409 }
    );
  }

  const ticketNumber = extractDevQaTicketNumber(releasePR.sourceBranch);

  if (!ticketNumber) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Release PR source branch must match devqa-(PICAF|HYPSDK)-<ticket>[-suffix]",
      },
      { status: 422 }
    );
  }

  const branchPrefixes = devQaTicketBranchPrefixes(ticketNumber);
  const possibleMainPRs = await prisma.mainPR.findMany({
    where: {
      patchFingerprint: { not: null },
      OR: branchPrefixes.map((prefix) => ({
        sourceBranch: { startsWith: prefix },
      })),
    },
    select: {
      id: true,
      title: true,
      author: true,
      displayName: true,
      status: true,
      mergedAt: true,
      sourceBranch: true,
      patchFingerprint: true,
    },
  });
  const mainPRs = possibleMainPRs.filter(
    (mainPR) =>
      extractDevQaTicketNumber(mainPR.sourceBranch) === ticketNumber
  );
  const scores = findPatchMatchesFromFingerprints(
    releasePR.patchFingerprint,
    mainPRs.map((mainPR) => ({
      mainPrId: mainPR.id,
      patchFingerprint: mainPR.patchFingerprint,
    })),
    { minScore: 0.6 }
  );
  const mainPRById = new Map(mainPRs.map((mainPR) => [mainPR.id, mainPR]));
  const matches = scores.flatMap((score) => {
    const mainPR = mainPRById.get(score.mainPrId);
    if (!mainPR) return [];

    return [{
      ...score,
      title: mainPR.title,
      author: mainPR.author,
      displayName: mainPR.displayName,
      status: mainPR.status,
      mergedAt: mainPR.mergedAt?.toISOString() ?? null,
      bitbucketUrl: prUrl(DEFAULT_REPO, mainPR.id),
    }];
  });

  return NextResponse.json({
    success: true,
    ticketNumber,
    searched: mainPRs.length,
    matches,
  });
}
