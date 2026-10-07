"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, GitBranch, GitCommitHorizontal, LoaderCircle, RefreshCw } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SummaryInfo } from "@/components/summary-info";
import { UiComponentReviewControls } from "@/components/ui-component-review-controls";
import { UiComponentListFilters } from "@/components/ui-component-list-filters";
import { canReviewUiComponentCommit } from "@/lib/ui-component-review";
import { filterUiComponentCommits, initialUiComponentListView, sameUiComponentStatuses, UI_COMPONENT_STATUSES, UI_COMPONENT_STATUS_LABELS as statusLabels, type UiComponentListView } from "@/lib/ui-component-filters";
import type { UiComponentDashboard, UiComponentDashboardCommit, UiComponentMatchStatus, UiComponentReviewAccess } from "@/lib/ui-component-types";

const statusColors: Record<UiComponentMatchStatus, string> = {
  MERGED: "bg-emerald-50 text-emerald-700 border-emerald-200", OPEN_PR: "bg-blue-50 text-blue-700 border-blue-200",
  NEEDS_REVIEW: "bg-orange-100 text-orange-700 border-orange-100", UNMATCHED: "bg-red-50 text-red-700 border-red-200",
  UNAVAILABLE: "bg-slate-50 text-slate-600 border-slate-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const bitbucketBase = (process.env.NEXT_PUBLIC_BITBUCKET_BASE_URL || "https://bitbucket.juspay.net").replace(/\/+$/, "");
const project = process.env.NEXT_PUBLIC_BITBUCKET_PROJECT_KEY || "PICAF";
const repoUrl = (repo: string) => `${bitbucketBase}/projects/${encodeURIComponent(project)}/repos/${repo}`;

async function loadDashboard(signal?: AbortSignal): Promise<UiComponentDashboard> {
  const response = await fetch("/api/ui-components", { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok || result.success !== true) throw new Error(result.error || "Could not load UI Components");
  return result;
}

export function UiComponentsDashboard() {
  const { isLoaded, userId } = useAuth();
  const [access, setAccess] = useState<(UiComponentReviewAccess & { userId: string }) | null>(null);
  const [data, setData] = useState<UiComponentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(initialUiComponentListView);
  const { branch, statuses, page, pageSize } = view;

  function updateView(patch: Partial<UiComponentListView>) {
    setView((current) => ({ ...current, ...patch, page: 1 }));
  }

  function applyBranchFilter(value: string) {
    updateView({ branch: value, statuses: [...UI_COMPONENT_STATUSES] });
  }

  function applyAuthorFilter(value: string) {
    updateView({ author: value, statuses: [...UI_COMPONENT_STATUSES] });
  }

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal).then(setData).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load UI Components");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const controller = new AbortController();
    fetch("/api/admins/me", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.success || !result.access) throw new Error("Could not load review access");
      if (!controller.signal.aborted) setAccess({ ...result.access, userId });
    }).catch(() => { if (!controller.signal.aborted) setAccess(null); });
    return () => controller.abort();
  }, [isLoaded, userId]);

  const reviewAccess = isLoaded && userId === access?.userId ? access : null;

  async function reloadAfterReview() {
    setData(await loadDashboard());
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try { setData(await loadDashboard()); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load UI Components"); }
    finally { setLoading(false); }
  }

  const filtered = useMemo(() => filterUiComponentCommits(data?.commits ?? [], view), [data, view]);
  const authors = useMemo(() => [...new Set(data?.commits.map((commit) => commit.authorName) ?? [])].sort((a, b) => a.localeCompare(b)), [data]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedBranch = data?.branches.find((item) => item.branch === branch);
  const summary = [
    { label: "Release commits", count: data?.commits.length ?? 0, status: "ALL" as const, description: "Unique custom ui-components commits across all discovered 2026 hyper-widget release branches. Jenkins commits are excluded." },
    { label: "Merged to main", count: data?.commits.filter((commit) => commit.matchStatus === "MERGED").length ?? 0, status: "MERGED" as const, description: "The exact commit SHA appears in a merged ui-components main PR, or an author/admin has confirmed a match to a merged PR." },
    { label: "Open main PRs", count: data?.commits.filter((commit) => commit.matchStatus === "OPEN_PR").length ?? 0, status: "OPEN_PR" as const, description: "An exact commit match or an author/admin-confirmed main PR is still open." },
    { label: "Needs review", count: data?.commits.filter((commit) => commit.matchStatus === "NEEDS_REVIEW").length ?? 0, status: "NEEDS_REVIEW" as const, description: "A patch suggestion, declined PR or changed/missing confirmed PR needs review. The commit author or an admin can confirm a match or approve it manually." },
    { label: "Approved", count: data?.commits.filter((commit) => commit.matchStatus === "APPROVED").length ?? 0, status: "APPROVED" as const, description: "The commit author or an admin manually approved this release commit. This does not mean a main PR was merged." },
  ];

  return (
    <div className="min-h-screen bg-background text-blue-900">
      <Navbar lastSyncedAt={data?.lastSynced} />
      <main className="mx-auto max-w-7xl space-y-6 px-3 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-500">hyper-widget dependencies · 2026</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">UI Components</h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-500">Custom release commits and their corresponding main pull requests.</p>
          </div>
          <button onClick={reload} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-surface px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm disabled:opacity-50">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Reload results
          </button>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
        {data?.refreshing && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">A UI Components refresh is running. These results show the last completed refresh. Reload after it finishes.</div>}
        {loading && !data && <div role="status" className="flex items-center justify-center gap-3 py-16 text-blue-500"><LoaderCircle className="h-5 w-5 animate-spin" />Loading UI Components…</div>}
        {!loading && !error && data && !data.runId && <div className="rounded-xl border border-blue-100 bg-surface p-8 text-center shadow-sm">
          <GitBranch className="mx-auto mb-3 h-8 w-8 text-blue-400" />
          <h2 className="text-lg font-semibold">No UI Components refresh yet</h2>
          <p className="mt-2 text-sm text-blue-500">Run the refresh from a laptop connected to the office network, then reload this page.</p>
          <code className="mt-4 inline-block rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">npm run refresh:ui-components</code>
        </div>}

        {data?.runId && <>
          {!data.reviewsAvailable && <div role="status" className="rounded-xl border border-orange-100 bg-orange-100 p-4 text-sm text-orange-700">Commit reviews are not enabled yet. Apply the latest database migrations, then reload. Existing release results remain available.</div>}
          {data.analysisVersion === 0 && <div role="status" className="rounded-xl border border-orange-100 bg-orange-100 p-4 text-sm text-orange-700">This snapshot contains dependency histories only. Run the updated <code>npm run refresh:ui-components</code> from the office network to add main PR matches.</div>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {summary.map((item) => {
              const preset = item.status === "ALL" ? UI_COMPONENT_STATUSES : [item.status];
              const active = sameUiComponentStatuses(statuses, preset);
              return <div key={item.label}
              className={`relative rounded-xl border bg-surface p-4 text-left shadow-sm transition hover:border-blue-400 ${active ? "border-blue-400 ring-1 ring-blue-200" : "border-blue-100"}`}>
              <button type="button" aria-label={`Filter by ${item.label}`} aria-pressed={active}
                onClick={() => updateView({ statuses: [...preset] })}
                className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" />
              <div className="pointer-events-none relative z-10">
                <span className="flex items-center justify-between gap-2 text-xs font-semibold text-blue-500">
                  {item.label}
                  <span className="pointer-events-auto shrink-0">
                    <SummaryInfo id={`ui-components-${item.status.toLowerCase()}-info`} text={item.description} align="end" />
                  </span>
                </span>
                <span className="mt-2 block text-3xl font-bold">{item.count}</span>
              </div>
            </div>; })}
          </div>

          <details className="rounded-xl border border-blue-100 bg-surface shadow-sm">
            <summary className="cursor-pointer px-4 py-4 text-sm font-semibold">{data.branches.length} hyper-widget release branches · {data.branches.filter((item) => item.status === "published-version").length} published versions · {data.mainPrCount} main PRs imported</summary>
            <div className="max-h-96 overflow-auto border-t border-blue-100">
              {data.branches.map((item) => <div key={item.branch} className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-4 py-3 text-xs">
                <div className="min-w-0 flex-1"><button onClick={() => applyBranchFilter(item.branch)} className="font-semibold text-blue-700 underline-offset-4 hover:underline">{item.branch}</button>
                  <p className="mt-1 break-all font-mono text-blue-500">{item.uiComponentsRef} <span className="font-sans">({item.uiComponentsRefType})</span></p>
                  <p className="mt-1 text-blue-400">Head {item.uiComponentsHeadSha.slice(0, 12)}{item.jenkinsBoundarySha ? ` · Jenkins boundary ${item.jenkinsBoundarySha.slice(0, 12)}` : ""}</p>
                  {item.uiComponentsBranches.length > 0 && <p className="mt-1 break-all text-blue-400">Containing branches: {item.uiComponentsBranches.join(", ")}</p>}
                  {item.warnings.map((warning, index) => <p key={index} className="mt-1 text-orange-700">{warning}</p>)}
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600">{item.status === "published-version" ? "Published version" : `${item.commitShas.length} custom commits`}</span>
                <a href={`${repoUrl("hyper-widget")}/browse?at=${encodeURIComponent(`refs/heads/${item.branch}`)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.branch} in Bitbucket`} className="text-blue-500"><ExternalLink className="h-4 w-4" /></a>
              </div>)}
            </div>
          </details>

          <UiComponentListFilters view={view} authors={authors} branches={data.branches.map((item) => item.branch)} total={filtered.length} onChange={updateView} />

          <section aria-label="Release commits" className="overflow-hidden rounded-xl border border-blue-100 bg-surface shadow-sm">
            <div className="border-b border-blue-100 px-4 py-3 text-sm font-semibold">{filtered.length} unique release commits{branch ? ` · ${branch}` : ""}</div>
            {rows.map((commit) => <CommitRow key={commit.sha} commit={commit} runId={data.runId!} canReview={data.reviewsAvailable && canReviewUiComponentCommit(reviewAccess, commit.authorEmail)} onReviewed={reloadAfterReview} onAuthor={applyAuthorFilter} onBranch={applyBranchFilter} />)}
            {!rows.length && <p className="px-4 py-10 text-center text-sm text-blue-500">{statuses.length === 0 ? "No statuses selected. Choose a status in Filters to show release commits." : selectedBranch?.status === "published-version" ? "This branch uses a published version and has no custom release commits." : "No release commits match these filters."}</p>}
            {filtered.length > 0 && <div className="flex items-center justify-between border-t border-blue-50 bg-blue-50/40 px-4 py-3 text-xs text-blue-500">
              <span>Page <strong className="text-blue-800">{currentPage}</strong> of <strong className="text-blue-800">{pageCount}</strong></span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setView((current) => ({ ...current, page: currentPage - 1 }))} className="rounded-lg border border-blue-100 bg-surface p-1.5 text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
                <button type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setView((current) => ({ ...current, page: currentPage + 1 }))} className="rounded-lg border border-blue-100 bg-surface p-1.5 text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
              </div>
            </div>}
          </section>
          <p className="text-xs leading-relaxed text-blue-400">Exact commit matches establish PR membership. Patch scores compare files and added/removed lines; even a 100% score needs review. Sign in as the commit author or an admin to confirm a match or approve a commit. {data.mainPrFingerprintUnavailable > 0 ? `${data.mainPrFingerprintUnavailable} main PR fingerprints are unavailable, so patch suggestions may be incomplete.` : ""}</p>
        </>}
      </main>
    </div>
  );
}

function CommitRow({ commit, runId, canReview, onReviewed, onAuthor, onBranch }: {
  commit: UiComponentDashboardCommit; runId: string; canReview: boolean; onReviewed: () => Promise<void>; onAuthor: (author: string) => void; onBranch: (branch: string) => void;
}) {
  return <article className="grid gap-4 border-b border-blue-50 p-4 lg:grid-cols-2">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><a href={`${repoUrl("ui-components")}/commits/${commit.sha}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-blue-600"><GitCommitHorizontal className="h-4 w-4" />{commit.sha.slice(0, 12)}<ExternalLink className="h-3 w-3" /></a>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColors[commit.matchStatus]}`}>{statusLabels[commit.matchStatus]}</span>
      </div>
      <p className="mt-2 break-words text-sm font-semibold" title={commit.message}>{commit.message.split("\n")[0] || "Untitled commit"}</p>
      <p className="mt-1 break-all text-xs text-blue-500"><button type="button" onClick={() => onAuthor(commit.authorName)} aria-label={`Filter by author ${commit.authorName}`} className="text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">{commit.authorName}</button>{commit.authorTimestamp ? ` · ${new Date(commit.authorTimestamp).toLocaleDateString()}` : ""}</p>
      <div className="mt-2 flex flex-wrap gap-1">{commit.branches.map((branch) => <button key={branch} onClick={() => onBranch(branch)} className="rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-600 hover:underline">{branch}</button>)}</div>
      {commit.review && <p className="mt-2 break-words text-[11px] text-blue-500">{commit.review.approved ? "Manually approved" : "Review updated"} by {commit.review.updatedBy} · {new Date(commit.review.updatedAt).toLocaleString()}{commit.review.mainPrId ? ` · Confirmed main PR #${commit.review.mainPrId}` : ""}</p>}
      {commit.reviewWarning && <p className="mt-2 text-xs text-orange-700">{commit.reviewWarning}</p>}
      {canReview && <UiComponentReviewControls commit={commit} runId={runId} onUpdated={onReviewed} />}
    </div>
    <div className="space-y-2">
      {commit.matches.map((match) => <div key={match.prId} className="rounded-lg border border-blue-100 bg-background px-3 py-2">
        <a href={`${repoUrl("ui-components")}/pull-requests/${match.prId}/overview`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">#{match.prId} · {match.title} <ExternalLink className="inline h-3 w-3" /></a>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-blue-500"><span className={`rounded border px-1.5 py-0.5 ${match.state === "MERGED" ? "border-emerald-200 text-emerald-700" : match.state === "OPEN" ? "border-blue-200 text-blue-700" : "border-red-200 text-red-700"}`}>{match.state}</span>
          <span>{match.reason === "exact-commit" ? "Exact commit SHA" : match.reason === "manual-confirmation" ? "Author/admin-confirmed match" : `Patch suggestion · ${Math.round((match.score ?? 0) * 100)}%`}</span>
        </div>
        {match.score !== null && <p className="mt-1 text-[11px] text-blue-400">Files {match.matchedFiles}/{match.totalFiles} · Added {match.matchedAddedLines}/{match.totalAddedLines} · Removed {match.matchedRemovedLines}/{match.totalRemovedLines}</p>}
      </div>)}
      {!commit.matches.length && <p className="text-xs text-blue-400">{commit.matchStatus === "UNAVAILABLE" ? "Patch analysis unavailable; no exact commit match found." : "No corresponding main PR found in the imported 2026 dataset."}</p>}
      {commit.fingerprintError && <p className="text-xs text-orange-700">{commit.fingerprintStatus === "SKIPPED_500" ? "Diff skipped after a recorded HTTP 500. " : ""}{commit.fingerprintError}</p>}
    </div>
  </article>;
}
