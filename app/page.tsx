"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Search,
  ExternalLink,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { StatusBadge } from "@/components/status-badge";
import { prUrl } from "@/lib/bitbucket";
import {
  syncAndLoad,
  updateDashboardViewState,
  useHyperSyncStore,
} from "@/lib/hypersync-store";
import type {
  DashboardPageSize,
  DashboardSortOption,
  DashboardStatusFilter,
} from "@/lib/hypersync-store";

const REPO = "hyper-widget";
const PAGE_SIZES = [10, 50, 100] as const;
const STATUS_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "MERGED", label: "Merged" },
  { value: "OPEN", label: "Open" },
  { value: "DECLINED", label: "Declined" },
  { value: "INVALID", label: "Invalid" },
  { value: "APPROVED", label: "Approved" },
  { value: "MISSING", label: "Missing" },
] satisfies Array<{ value: StatusFilter; label: string }>;
const SORT_OPTIONS = [
  { value: "mergedAt", label: "Merged At" },
  { value: "updatedAt", label: "Updated At" },
  { value: "author", label: "Author" },
  { value: "releaseBranch", label: "Release Branch" },
  { value: "title", label: "Title" },
] satisfies Array<{ value: SortOption; label: string }>;

type StatusFilter = DashboardStatusFilter;
type SortOption = DashboardSortOption;

export default function Home() {
  const router = useRouter();
  const {
    releasePRs: data,
    syncStatus,
    summary,
    leaderboard,
    branchLeaderboard,
    pagination,
    dashboardView,
    loading,
    initialized,
    error,
  } = useHyperSyncStore();
  const {
    query,
    pageSize,
    currentPage,
    statusFilter,
    sortBy,
    sortDirection,
  } = dashboardView;
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void syncAndLoad({ force: true }),
      query ? 250 : 0
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentPage, pageSize, query, sortBy, sortDirection, statusFilter]);

  const { total, unsynced, merged, approved } = summary;
  const totalPages = pagination.totalPages;
  const activePage = pagination.page;
  const pageStartIndex = (activePage - 1) * pageSize;
  const pageEndIndex = pageStartIndex + pageSize;
  const pageStart = pagination.total === 0 ? 0 : pageStartIndex + 1;
  const pageEnd = Math.min(pageEndIndex, pagination.total);
  const initialLoading = !initialized && data.length === 0 && !error;

  const rankColors = [
    "from-red-500 to-red-400",
    "from-orange-500 to-amber-400",
    "from-amber-400 to-yellow-300",
    "from-blue-500 to-blue-400",
    "from-violet-500 to-violet-400",
  ];

  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <Navbar lastSyncedAt={syncStatus.lastSyncedAt} />

      <main className="mx-auto max-w-7xl px-6 py-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {initialLoading ? (
          <InitialSyncLoading />
        ) : (
          <>
        {/* SECTION 2 — SUMMARY CARDS */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-blue-500">Total Release PRs</p>
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
            <p className="mt-2 text-4xl font-bold text-blue-900">{total}</p>
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-red-600">Total Unsynced PRs</p>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <p className="mt-2 text-4xl font-bold text-red-600">{unsynced}</p>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-emerald-600">Merged PRs</p>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-4xl font-bold text-emerald-600">{merged}</p>
          </div>

          <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-teal-600">Approved PRs</p>
              <CheckCircle2 className="h-4 w-4 text-teal-500" />
            </div>
            <p className="mt-2 text-4xl font-bold text-teal-600">{approved}</p>
          </div>
        </div>

        {/* SECTION 3 — RISK LEADERBOARD */}
        <div className="rounded-xl border border-blue-100 bg-white shadow-sm">
          <div className="border-b border-blue-50 bg-blue-50/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-blue-800">
              🏆 Top Risk Contributors — Unsynced PRs
            </h2>
          </div>
          <div className="p-5">
            {leaderboard.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-1">
                {leaderboard.map(([author, count], i) => (
                  <div
                    key={author}
                    className="flex shrink-0 items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-5 py-4"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
                        rankColors[i] ?? "from-slate-400 to-slate-300"
                      } text-sm font-bold text-white shadow`}
                    >
                      #{i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{author}</p>
                      <p className="text-xs text-slate-500">
                        {count} unsynced PR{count > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !loading && (
                <p className="text-center text-sm font-medium text-emerald-600">
                  🎉 All release PRs are synced. Baseline alignment achieved!
                </p>
              )
            )}
          </div>
        </div>

        <div className="rounded-xl border border-blue-100 bg-white shadow-sm">
          <div className="border-b border-blue-50 bg-blue-50/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-blue-800">
              Top Release Branches — Unsynced PRs
            </h2>
          </div>
          <div className="p-5">
            {branchLeaderboard.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-1">
                {branchLeaderboard.map(([releaseBranch, count], i) => (
                  <div
                    key={releaseBranch}
                    className="flex shrink-0 items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-5 py-4"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
                        rankColors[i] ?? "from-slate-400 to-slate-300"
                      } text-sm font-bold text-white shadow`}
                    >
                      #{i + 1}
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold text-slate-800">
                        {releaseBranch}
                      </p>
                      <p className="text-xs text-slate-500">
                        {count} unsynced PR{count > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              !loading && (
                <p className="text-center text-sm font-medium text-emerald-600">
                  All release branches are synced.
                </p>
              )
            )}
          </div>
        </div>

        {/* SECTION 4 — SEARCH */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                updateDashboardViewState({
                  query: e.target.value,
                  currentPage: 1,
                });
              }}
              placeholder="Search by PR ID, title, author, branch…"
              className="w-full rounded-lg border border-blue-200 bg-white py-2 pl-9 pr-4 text-sm text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
              </button>
              {filtersOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-blue-100 bg-white p-4 shadow-xl">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-900">
                      Filters
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      title="Close filters"
                      className="rounded-md p-1 text-blue-300 transition hover:bg-blue-50 hover:text-blue-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-blue-400">
                      Status
                      <select
                        value={statusFilter}
                        onChange={(e) => {
                          updateDashboardViewState({
                            statusFilter: e.target.value as StatusFilter,
                            currentPage: 1,
                          });
                        }}
                        className="mt-1.5 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      >
                        {STATUS_FILTERS.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wider text-blue-400">
                        Sort By
                      </span>
                      <div className="mt-1.5 flex gap-2">
                        <select
                          value={sortBy}
                          onChange={(e) => {
                            updateDashboardViewState({
                              sortBy: e.target.value as SortOption,
                              currentPage: 1,
                            });
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        >
                          {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            updateDashboardViewState((view) => ({
                              sortDirection:
                                view.sortDirection === "asc" ? "desc" : "asc",
                              currentPage: 1,
                            }));
                          }}
                          title={
                            sortDirection === "asc"
                              ? "Sorted ascending"
                              : "Sorted descending"
                          }
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-white text-blue-600 shadow-sm transition hover:bg-blue-50"
                        >
                          {sortDirection === "asc" ? (
                            <ArrowUp className="h-4 w-4" />
                          ) : (
                            <ArrowDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-blue-500">
              Rows
              <select
                value={pageSize}
                onChange={(e) => {
                  updateDashboardViewState({
                    pageSize: Number(e.target.value) as DashboardPageSize,
                    currentPage: 1,
                  });
                }}
                className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs font-semibold text-blue-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            {!loading && (
              <p className="text-xs text-blue-400">
                Showing <strong className="text-blue-700">{pageStart}-{pageEnd}</strong>{" "}
                of <strong className="text-blue-700">{pagination.total}</strong> PRs
              </p>
            )}
          </div>
        </div>

        {/* SECTION 5 — MASTER DATA TABLE */}
        <div className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
          {loading && data.length === 0 ? (
            <div className="py-16 text-center text-sm text-blue-400">
              <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
              Loading release PRs…
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-blue-100 bg-blue-50/60 text-left text-xs font-semibold uppercase tracking-wider text-blue-600">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">PR ID</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">Release Branch</th>
                  <th className="px-4 py-3">Main PR</th>
                  <th className="px-4 py-3">Merged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-50">
                {data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-12 text-center text-blue-300"
                    >
                      No PRs match your search.
                    </td>
                  </tr>
                ) : (
                  data.map((pr) => (
                    <tr
                      key={pr.id}
                      onMouseEnter={() => router.prefetch(`/pr/${pr.id}`)}
                      onClick={() => router.push(`/pr/${pr.id}`)}
                      className="cursor-pointer transition hover:bg-blue-50/40"
                    >
                      <td className="px-4 py-3">
                        <StatusBadge status={pr.syncStatus} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        <a
                          href={prUrl(REPO, pr.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          #{pr.id}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-slate-800">
                        <span className="line-clamp-2">{pr.title}</span>
                      </td>
                      <td className="px-4 py-3 text-blue-800">{pr.author}</td>
                      <td className="px-4 py-3 font-mono text-xs text-blue-500">
                        {pr.releaseBranch}
                      </td>
                      <td className="px-4 py-3">
                        {pr.mainPrId ? (
                          <a
                            href={prUrl(REPO, pr.mainPrId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline"
                          >
                            #{pr.mainPrId}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                        <td className="px-4 py-3 text-xs text-blue-400">
                          {pr.mergedAt
                            ? new Date(pr.mergedAt).toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })
                            : <span className="text-slate-300">—</span>}
                        </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          )}
          {!loading && pagination.total > 0 && (
            <div className="flex items-center justify-between border-t border-blue-50 bg-blue-50/40 px-4 py-3">
              <p className="text-xs font-medium text-blue-500">
                Page <span className="text-blue-800">{activePage}</span> of{" "}
                <span className="text-blue-800">{totalPages}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateDashboardViewState({
                      currentPage: Math.max(1, activePage - 1),
                    })
                  }
                  disabled={activePage === 1}
                  title="Previous page"
                  className="rounded-lg border border-blue-100 bg-white p-1.5 text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateDashboardViewState({
                      currentPage: Math.min(totalPages, activePage + 1),
                    })
                  }
                  disabled={activePage === totalPages}
                  title="Next page"
                  className="rounded-lg border border-blue-100 bg-white p-1.5 text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
          </>
        )}
      </main>
    </div>
  );
}

function InitialSyncLoading() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <RefreshCw className="mb-4 h-8 w-8 animate-spin text-blue-500" />
          <h1 className="text-lg font-semibold text-blue-900">
            Loading sync data
          </h1>
          <p className="mt-2 max-w-md text-sm text-blue-500">
            Fetching release and main PRs from the current sync store.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-xl border border-blue-100 bg-white p-5 shadow-sm"
          >
            <div className="h-4 w-28 rounded bg-blue-100" />
            <div className="mt-5 h-9 w-16 rounded bg-blue-100" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
        <div className="mb-4 h-4 w-48 animate-pulse rounded bg-blue-100" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="grid animate-pulse grid-cols-[72px_1fr] gap-3 sm:grid-cols-[80px_120px_1fr_140px] sm:gap-4"
            >
              <div className="h-4 rounded bg-blue-50" />
              <div className="h-4 rounded bg-blue-50" />
              <div className="h-4 rounded bg-blue-50" />
              <div className="h-4 rounded bg-blue-50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
