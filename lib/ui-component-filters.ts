import type { UiComponentDashboardCommit, UiComponentMatchStatus } from "./ui-component-types";

export const UI_COMPONENT_STATUS_LABELS: Record<UiComponentMatchStatus, string> = {
  MERGED: "Merged to main",
  OPEN_PR: "Open main PR",
  APPROVED: "Manually approved",
  NEEDS_REVIEW: "Needs review",
  UNMATCHED: "No match",
  UNAVAILABLE: "Analysis unavailable",
};
export const UI_COMPONENT_STATUSES = Object.keys(UI_COMPONENT_STATUS_LABELS) as UiComponentMatchStatus[];
export const UI_COMPONENT_PAGE_SIZES = [10, 50, 100] as const;
export const UI_COMPONENT_SORT_OPTIONS = [
  { value: "authorTimestamp", label: "Commit date" },
  { value: "reviewedAt", label: "Reviewed at" },
  { value: "author", label: "Author" },
  { value: "releaseBranch", label: "Release branch" },
  { value: "message", label: "Commit message" },
  { value: "matchStatus", label: "Match status" },
] as const;

export type UiComponentListView = {
  query: string;
  author: string;
  branch: string;
  statuses: UiComponentMatchStatus[];
  sortBy: (typeof UI_COMPONENT_SORT_OPTIONS)[number]["value"];
  sortDirection: "asc" | "desc";
  pageSize: (typeof UI_COMPONENT_PAGE_SIZES)[number];
  page: number;
};

export function initialUiComponentListView(): UiComponentListView {
  return { query: "", author: "", branch: "", statuses: [...UI_COMPONENT_STATUSES], sortBy: "authorTimestamp", sortDirection: "desc", pageSize: 10, page: 1 };
}

export function sameUiComponentStatuses(selected: readonly UiComponentMatchStatus[], expected: readonly UiComponentMatchStatus[]) {
  return selected.length === expected.length && expected.every((status) => selected.includes(status));
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function filterUiComponentCommits(commits: readonly UiComponentDashboardCommit[], view: UiComponentListView) {
  const search = view.query.trim().toLowerCase();
  const filtered = commits.filter((commit) => view.statuses.includes(commit.matchStatus)
    && (!view.branch || commit.branches.includes(view.branch))
    && (!view.author || commit.authorName === view.author)
    && (!search || [commit.sha, commit.message, commit.authorName, commit.authorEmail ?? "", ...commit.branches,
      ...commit.matches.map((match) => `#${match.prId} ${match.title}`)].some((text) => text.toLowerCase().includes(search))));

  return filtered.sort((a, b) => {
    let result: number;
    if (view.sortBy === "authorTimestamp" || view.sortBy === "reviewedAt") {
      const aDate = Date.parse((view.sortBy === "authorTimestamp" ? a.authorTimestamp : a.review?.updatedAt) ?? "");
      const bDate = Date.parse((view.sortBy === "authorTimestamp" ? b.authorTimestamp : b.review?.updatedAt) ?? "");
      // Missing dates stay last in either direction, not mistaken for today.
      if (Number.isNaN(aDate) !== Number.isNaN(bDate)) return Number.isNaN(aDate) ? 1 : -1;
      result = Number.isNaN(aDate) ? 0 : aDate - bDate;
    } else {
      const value = (commit: UiComponentDashboardCommit) => {
        if (view.sortBy === "author") return commit.authorName;
        if (view.sortBy === "releaseBranch") return [...commit.branches].sort(compareText).join(", ");
        if (view.sortBy === "matchStatus") return UI_COMPONENT_STATUS_LABELS[commit.matchStatus];
        return commit.message;
      };
      result = compareText(value(a), value(b));
    }
    return (view.sortDirection === "asc" ? result : -result) || a.sha.localeCompare(b.sha);
  });
}
