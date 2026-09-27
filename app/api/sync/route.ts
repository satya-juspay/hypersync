import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  releasePrPublicSelect,
  toReleasePrView,
  type ReleasePrPublicRecord,
} from "@/lib/release-pr-view";
import type { ReleasePR, ReleasePRStatus } from "@/types/hypersync";

export const dynamic = "force-dynamic";

const PAGE_SIZES = new Set([10, 50, 100]);
const STATUSES = new Set<ReleasePRStatus>([
  "MERGED",
  "OPEN",
  "DECLINED",
  "INVALID",
  "APPROVED",
  "MISSING",
]);
const SORT_FIELDS = new Set([
  "mergedAt",
  "updatedAt",
  "author",
  "releaseBranch",
  "title",
]);

type SortField = "mergedAt" | "updatedAt" | "author" | "releaseBranch" | "title";
type SortDirection = "asc" | "desc";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const requestedPage = positiveInteger(params.get("page"), 1);
  const requestedPageSize = positiveInteger(params.get("pageSize"), 10);
  const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 10;
  const query = params.get("q")?.trim().toLowerCase() ?? "";
  const contributor = params.get("contributor")?.trim().toLowerCase() ?? "";
  const releaseBranch =
    params.get("releaseBranch")?.trim().toLowerCase() ?? "";
  const statuses = selectedStatuses(params);
  const requestedSort = params.get("sortBy") ?? "mergedAt";
  const sortBy = SORT_FIELDS.has(requestedSort)
    ? (requestedSort as SortField)
    : "mergedAt";
  const sortDirection: SortDirection =
    params.get("sortDirection") === "asc" ? "asc" : "desc";

  const [releaseRecords, mainRecords, syncStatus] = await Promise.all([
    prisma.releasePR.findMany({ select: releasePrPublicSelect }),
    prisma.mainPR.findMany({ select: { id: true, status: true } }),
    prisma.syncStatus.findUnique({ where: { id: "singleton" } }),
  ]);
  const mainStatusById = new Map(
    mainRecords.map((mainPR) => [mainPR.id, mainPR.status])
  );
  const allReleasePRs = releaseRecords.map((releasePR) =>
    toReleasePrView(
      releasePR as ReleasePrPublicRecord,
      releasePR.mainPrId
        ? mainStatusById.get(releasePR.mainPrId)
        : undefined
    )
  );

  const summary = summarize(allReleasePRs);
  const { leaderboard, branchLeaderboard } = buildLeaderboards(allReleasePRs);
  const filtered = allReleasePRs
    .filter((releasePR) => matchesQuery(releasePR, query))
    .filter(
      (releasePR) =>
        !contributor || contributorName(releasePR).toLowerCase() === contributor
    )
    .filter(
      (releasePR) =>
        !releaseBranch ||
        releasePR.releaseBranch.toLowerCase() === releaseBranch
    )
    .filter(
      (releasePR) => statuses === null || statuses.has(releasePR.syncStatus)
    )
    .sort((left, right) => compareReleasePRs(left, right, sortBy, sortDirection));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  return NextResponse.json({
    success: true,
    data,
    pagination: {
      page,
      pageSize,
      total: filtered.length,
      totalPages,
    },
    summary,
    leaderboard,
    branchLeaderboard,
    syncStatus: {
      isRunning: syncStatus?.isRunning ?? false,
      lastSynced: syncStatus?.lastSynced?.toISOString() ?? null,
    },
  });
}

function selectedStatuses(params: URLSearchParams) {
  const requestedStatuses = params.get("statuses");
  if (requestedStatuses !== null) {
    return new Set(
      requestedStatuses
        .split(",")
        .map((status) => status.trim().toUpperCase())
        .filter((status): status is ReleasePRStatus =>
          STATUSES.has(status as ReleasePRStatus)
        )
    );
  }

  // Preserve compatibility with links using the former single-status filter.
  const requestedStatus = params.get("status")?.toUpperCase();
  return requestedStatus && STATUSES.has(requestedStatus as ReleasePRStatus)
    ? new Set([requestedStatus as ReleasePRStatus])
    : null;
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function matchesQuery(releasePR: ReleasePR, query: string) {
  if (!query) return true;

  return [
    releasePR.id,
    releasePR.title,
    releasePR.author,
    releasePR.displayName,
    releasePR.releaseBranch,
    releasePR.mainPrId,
  ].some((value) => value?.toLowerCase().includes(query));
}

function contributorName(releasePR: ReleasePR) {
  return (
    releasePR.author.trim() ||
    releasePR.displayName?.trim() ||
    "Unknown contributor"
  );
}

function summarize(releasePRs: ReleasePR[]) {
  let merged = 0;
  let approved = 0;

  for (const releasePR of releasePRs) {
    if (releasePR.syncStatus === "MERGED") merged += 1;
    if (releasePR.syncStatus === "APPROVED") approved += 1;
  }

  return {
    total: releasePRs.length,
    merged,
    approved,
    unsynced: releasePRs.length - merged - approved,
  };
}

function buildLeaderboards(releasePRs: ReleasePR[]) {
  const authors = new Map<string, number>();
  const branches = new Map<string, number>();

  for (const releasePR of releasePRs) {
    if (
      releasePR.syncStatus === "MERGED" ||
      releasePR.syncStatus === "APPROVED"
    ) {
      continue;
    }

    const contributor = contributorName(releasePR);
    authors.set(contributor, (authors.get(contributor) ?? 0) + 1);
    branches.set(
      releasePR.releaseBranch,
      (branches.get(releasePR.releaseBranch) ?? 0) + 1
    );
  }

  return {
    leaderboard: [...authors.entries()].sort((a, b) => b[1] - a[1]),
    branchLeaderboard: [...branches.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function compareReleasePRs(
  left: ReleasePR,
  right: ReleasePR,
  sortBy: SortField,
  sortDirection: SortDirection
) {
  const direction = sortDirection === "asc" ? 1 : -1;
  const leftValue = sortValue(left, sortBy);
  const rightValue = sortValue(right, sortBy);

  return (
    leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: "base",
    }) * direction
  );
}

function sortValue(releasePR: ReleasePR, sortBy: SortField) {
  if (sortBy === "mergedAt") return releasePR.mergedAt ?? "";
  if (sortBy === "updatedAt") return releasePR.updatedAt ?? "";
  if (sortBy === "releaseBranch") return releasePR.releaseBranch;
  if (sortBy === "title") return releasePR.title;
  return releasePR.displayName || releasePR.author;
}
