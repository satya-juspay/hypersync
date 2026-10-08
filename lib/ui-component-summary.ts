import type { UiComponentDashboardCommit, UiComponentMatchStatus } from "./ui-component-types";

export const UI_COMPONENT_UNSYNCED_STATUSES = [
  "OPEN_PR", "NEEDS_REVIEW", "UNMATCHED", "UNAVAILABLE",
] as const satisfies readonly UiComponentMatchStatus[];

export function summarizeUiComponentCommits(commits: readonly UiComponentDashboardCommit[]) {
  const uniqueCommits = [...new Map(commits.map((commit) => [commit.sha, commit])).values()];
  const authors = new Map<string, number>();
  const branches = new Map<string, number>();
  let merged = 0;
  let approved = 0;
  let unsynced = 0;
  for (const commit of uniqueCommits) {
    if (commit.matchStatus === "MERGED") { merged++; continue; }
    if (commit.matchStatus === "APPROVED") { approved++; continue; }
    unsynced++;
    authors.set(commit.authorName, (authors.get(commit.authorName) ?? 0) + 1);
    // A shared commit counts once overall, and once for each affected release branch.
    for (const branch of new Set(commit.branches)) branches.set(branch, (branches.get(branch) ?? 0) + 1);
  }
  const rank = (counts: Map<string, number>) => [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b)).slice(0, 5);
  return { total: uniqueCommits.length, unsynced, merged, approved, contributors: rank(authors), branches: rank(branches) };
}
