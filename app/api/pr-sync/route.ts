import { NextRequest, NextResponse } from "next/server";
import { fetchPullRequest, resolveMainPrStatus } from "@/lib/bitbucket";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { repo, prId } = body;

    if (!repo || !prId) {
      return NextResponse.json(
        { error: "Missing required fields: repo, prId" },
        { status: 400 }
      );
    }

    const prData = await fetchPullRequest(repo, Number(prId));

    const title = prData.title;
    const description = prData.description || "";
    const author = prData.author.user.displayName;
    const releaseBranch = prData.toRef.displayId;
    const mergeCommitSha = prData.properties?.mergeCommit?.id || null;

    if (!releaseBranch.startsWith("release-")) {
      return NextResponse.json({
        ignored: true,
        reason: "Not a release branch PR",
      });
    }

    const match =
      description.match(/pull-requests\/(\d+)/i) ??
      description.match(/main branch PR.*?#(\d+)/i);
    const mainPrId = match?.[1] || null;

    let syncStatus = "MISSING_MAIN_PR";
    if (mainPrId) {
      syncStatus = await resolveMainPrStatus(repo, Number(mainPrId));
    }

    const record = await prisma.releasePR.upsert({
      where: { id: String(prData.id) },
      update: {
        title,
        description,
        author,
        releaseBranch,
        mainPrId,
        syncStatus,
        mergeCommitSha,
      },
      create: {
        id: String(prData.id),
        title,
        description,
        author,
        releaseBranch,
        mainPrId,
        syncStatus,
        mergeCommitSha,
      },
    });

    return NextResponse.json(record, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync PR" },
      { status: 500 }
    );
  }
}

