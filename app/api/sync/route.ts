import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_REPO,
  fetchReleasePullRequests,
  fetchPullRequests,
  fetchPullRequestPatchFingerprint,
  extractMainPrId,
} from "@/lib/bitbucket";

export const dynamic = "force-dynamic";

const START_OF_MARCH_2026 = new Date("2026-03-01T00:00:00.000Z");

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { quick?: boolean };

  // Quick mode — just return whatever is currently in the DB
  if (body.quick) {
    const [releasePRs, mainPRs, syncStatus] = await Promise.all([
      prisma.releasePR.findMany(),
      prisma.mainPR.findMany(),
      prisma.syncStatus.findUnique({ where: { id: "singleton" } }),
    ]);
    return NextResponse.json({
      success: true,
      syncStatus: {
        isRunning: syncStatus?.isRunning ?? false,
        lastSynced: syncStatus?.lastSynced?.toISOString() ?? null,
      },
      releasePRsCount: releasePRs.length,
      mainPRsCount: mainPRs.length,
      releasePRs,
      mainPRs,
    });
  }

  console.log("[sync] Starting sync");

  const syncStatus = await prisma.syncStatus.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", isRunning: false, lastSynced: null },
    update: {},
  });

  if (syncStatus.isRunning) {
    console.log("[sync] Already in progress — aborting");
    return NextResponse.json(
      { success: false, error: "Sync already in progress" },
      { status: 409 }
    );
  }

  await prisma.syncStatus.update({
    where: { id: "singleton" },
    data: { isRunning: true },
  });

  const mergedAfter = syncStatus.lastSynced ?? START_OF_MARCH_2026;
  const mainPrUpdatedAfter = START_OF_MARCH_2026;
  const repo = DEFAULT_REPO;

  console.log(
    `[sync] Fetching release PRs merged after ${mergedAfter.toISOString()} and main PRs updated after ${mainPrUpdatedAfter.toISOString()} from repo "${repo}"`
  );

  try {
    const [releasePRsBitbucket, allPRsBitbucket] = await Promise.all([
      fetchReleasePullRequests(repo, { mergedAfter }),
      fetchPullRequests(repo, { state: "ALL", maxPages: 20 }),
    ]);

    const mainBranches = new Set(["main", "master"]);
    const mainPrUpdatedAfterTime = mainPrUpdatedAfter.getTime();
    const mainPRsBitbucket = allPRsBitbucket.filter((pr) => {
      const branch = pr.toRef?.displayId?.toLowerCase() ?? "";
      if (!mainBranches.has(branch)) return false;
      const updatedAt = Number(pr.updatedDate ?? pr.createdDate);
      return !Number.isNaN(updatedAt) && updatedAt >= mainPrUpdatedAfterTime;
    });

    console.log(`[sync] Fetched ${releasePRsBitbucket.length} release PRs, ${mainPRsBitbucket.length} main PRs`);

    const [releasePatchFingerprints, mainPatchFingerprints] = await Promise.all([
      fetchPatchFingerprintMap(repo, releasePRsBitbucket.map((pr) => pr.id)),
      fetchPatchFingerprintMap(repo, mainPRsBitbucket.map((pr) => pr.id)),
    ]);

    console.log(`[sync] Upserting ${releasePRsBitbucket.length} release PRs into DB`);

    for (const pr of releasePRsBitbucket) {
      const id = String(pr.id);
      const mainPrId = extractMainPrId(pr.description ?? "");
      const author = pr.author?.user?.emailAddress ?? pr.author?.user?.email ?? "";
      const displayName = pr.author?.user?.displayName ?? pr.author?.user?.name ?? "Unknown author";
      const mergedAt = pr.state === "MERGED" ? (pr.closedDate ?? pr.updatedDate) : null;
      const patchFingerprint = releasePatchFingerprints.get(id) ?? null;

      const existing = await prisma.releasePR.findUnique({ where: { id } });

      if (!existing) {
        await prisma.releasePR.create({
          data: {
            id,
            title: pr.title ?? `PR #${id}`,
            author,
            displayName,
            releaseBranch: pr.toRef?.displayId ?? "",
            mainPrId,
            patchFingerprint,
            mergedAt: mergedAt ? new Date(Number(mergedAt)) : null,
          },
        });
        console.log(`[sync] Created release PR #${id} (mainPrId=${mainPrId ?? "none"})`);
      } else if (existing.updatedStatus === null) {
        await prisma.releasePR.update({
          where: { id },
          data: {
            title: pr.title ?? `PR #${id}`,
            author,
            displayName,
            mainPrId,
            ...(patchFingerprint !== null && { patchFingerprint }),
            mergedAt: mergedAt ? new Date(Number(mergedAt)) : null,
          },
        });
        console.log(`[sync] Updated release PR #${id} (mainPrId=${mainPrId ?? "none"})`);
      } else {
        // updatedStatus is set — preserve user edits but still fix author/displayName
        await prisma.releasePR.update({
          where: { id },
          data: {
            author,
            displayName,
            ...(patchFingerprint !== null && { patchFingerprint }),
          },
        });
        console.log(`[sync] Updated author/displayName for PR #${id} (updatedStatus preserved)`);
      }
    }

    console.log(`[sync] Upserting ${mainPRsBitbucket.length} main PRs into DB`);

    for (const pr of mainPRsBitbucket) {
      const id = String(pr.id);
      const author = pr.author?.user?.emailAddress ?? pr.author?.user?.email ?? "";
      const displayName = pr.author?.user?.displayName ?? pr.author?.user?.name ?? "Unknown author";
      const mergedAt = pr.state === "MERGED" ? (pr.closedDate ?? pr.updatedDate) : null;
      const status = pr.state ?? "MERGED";
      const patchFingerprint = mainPatchFingerprints.get(id) ?? null;
      await prisma.mainPR.upsert({
        where: { id },
        create: {
          id,
          title: pr.title ?? `PR #${id}`,
          author,
          displayName,
          status,
          patchFingerprint,
          mergedAt: mergedAt ? new Date(Number(mergedAt)) : null,
        },
        update: {
          title: pr.title ?? `PR #${id}`,
          author,
          displayName,
          status,
          ...(patchFingerprint !== null && { patchFingerprint }),
          mergedAt: mergedAt ? new Date(Number(mergedAt)) : null,
        },
      });
      console.log(`[sync] Upserted main PR #${id} (${status})`);
    }

    const lastSynced = new Date();

    await backfillMissingPatchFingerprints(repo);

    await prisma.syncStatus.update({
      where: { id: "singleton" },
      data: { isRunning: false, lastSynced },
    });

    const [releasePRs, mainPRs] = await Promise.all([
      prisma.releasePR.findMany(),
      prisma.mainPR.findMany(),
    ]);

    console.log(`[sync] Completed — ${releasePRsBitbucket.length} release PRs, ${mainPRsBitbucket.length} main PRs. lastSynced=${lastSynced.toISOString()}`);

    return NextResponse.json({
      success: true,
      syncStatus: { isRunning: false, lastSynced: lastSynced.toISOString() },
      releasePRsCount: releasePRs.length,
      mainPRsCount: mainPRs.length,
      releasePRs,
      mainPRs,
    });
  } catch (error) {
    console.error("[sync] Sync failed:", error instanceof Error ? error.message : error);

    await prisma.syncStatus.update({
      where: { id: "singleton" },
      data: { isRunning: false },
    });

    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function fetchPatchFingerprintMap(
  repo: string,
  ids: Array<string | number>
) {
  const fingerprints = new Map<string, string | null>();
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id))));
  const concurrency = 5;

  for (let start = 0; start < uniqueIds.length; start += concurrency) {
    const batch = uniqueIds.slice(start, start + concurrency);
    const entries = await Promise.all(
      batch.map(async (id) => [
        id,
        await safeFetchPatchFingerprint(repo, id),
      ] as const)
    );

    for (const [id, fingerprint] of entries) {
      fingerprints.set(id, fingerprint);
    }
  }

  return fingerprints;
}

async function safeFetchPatchFingerprint(repo: string, prId: string | number) {
  try {
    return await fetchPullRequestPatchFingerprint(repo, prId);
  } catch (error) {
    console.warn(
      `[sync] Failed to fetch patch fingerprint for PR #${prId}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

async function backfillMissingPatchFingerprints(repo: string) {
  const [releasePRs, mainPRs] = await Promise.all([
    prisma.releasePR.findMany({
      where: { patchFingerprint: null },
      select: { id: true },
    }),
    prisma.mainPR.findMany({
      where: { patchFingerprint: null },
      select: { id: true },
    }),
  ]);

  const [releaseFingerprints, mainFingerprints] = await Promise.all([
    fetchPatchFingerprintMap(repo, releasePRs.map((pr) => pr.id)),
    fetchPatchFingerprintMap(repo, mainPRs.map((pr) => pr.id)),
  ]);

  await Promise.all([
    ...releasePRs.map((pr) => {
      const patchFingerprint = releaseFingerprints.get(pr.id);
      if (patchFingerprint === null || patchFingerprint === undefined) {
        return Promise.resolve();
      }

      return prisma.releasePR.update({
        where: { id: pr.id },
        data: { patchFingerprint },
      });
    }),
    ...mainPRs.map((pr) => {
      const patchFingerprint = mainFingerprints.get(pr.id);
      if (patchFingerprint === null || patchFingerprint === undefined) {
        return Promise.resolve();
      }

      return prisma.mainPR.update({
        where: { id: pr.id },
        data: { patchFingerprint },
      });
    }),
  ]);
}
