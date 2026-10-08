"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, GitBranch, GitCommitHorizontal, LoaderCircle, RefreshCw, TrendingUp } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { SummaryFilterCard } from "@/components/summary-filter-card";
import { DashboardRiskLeaderboard } from "@/components/dashboard-risk-leaderboard";
import { StatusBadge } from "@/components/status-badge";
import { UiComponentReviewControls } from "@/components/ui-component-review-controls";
import { UiComponentListFilters } from "@/components/ui-component-list-filters";
import { canReviewUiComponentCommit } from "@/lib/ui-component-review";
import { filterUiComponentCommits, initialUiComponentListView, sameUiComponentStatuses, UI_COMPONENT_STATUSES, UI_COMPONENT_STATUS_LABELS as statusLabels, type UiComponentListView } from "@/lib/ui-component-filters";
import { summarizeUiComponentCommits, UI_COMPONENT_UNSYNCED_STATUSES } from "@/lib/ui-component-summary";
import type { UiComponentDashboard, UiComponentDashboardCommit, UiComponentMatchStatus, UiComponentReviewAccess } from "@/lib/ui-component-types";

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
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
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
  const summary = useMemo(() => summarizeUiComponentCommits(data?.commits ?? []), [data]);

  function toggleDetails(sha: string) {
    setExpandedSha((current) => current === sha ? null : sha);
  }

  return (
    <div className="min-h-screen bg-background text-blue-900">
      <Navbar lastSyncedAt={data?.lastSynced} />
      <main className="mx-auto max-w-7xl space-y-4 px-6 py-4">
        <h1 className="sr-only">UI Components release commits</h1>

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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryFilterCard label="Total Release Commits" value={summary.total}
              infoId="ui-components-all-info" infoAlign="end"
              infoText="Unique custom ui-components commits across all discovered 2026 hyper-widget release branches. Shared commits count once; Jenkins commits are excluded."
              icon={<TrendingUp className="h-4 w-4 text-blue-400" />}
              cardClassName="border-blue-100 bg-surface" labelClassName="text-blue-500" valueClassName="text-blue-900" activeClassName="ring-blue-400"
              active={sameUiComponentStatuses(statuses, UI_COMPONENT_STATUSES)} onSelect={() => updateView({ statuses: [...UI_COMPONENT_STATUSES] })} />
            <SummaryFilterCard label="Total Unsynced Commits" value={summary.unsynced}
              infoId="ui-components-unsynced-info" infoAlign="end"
              infoText="Release commits not merged to main or manually approved. Includes open main PRs, commits needing review, unmatched commits and unavailable analysis. Patch suggestions alone do not establish a merged match."
              icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
              cardClassName="border-red-200 bg-red-50/40" labelClassName="text-red-600" valueClassName="text-red-600" activeClassName="ring-red-400"
              active={sameUiComponentStatuses(statuses, UI_COMPONENT_UNSYNCED_STATUSES)} onSelect={() => updateView({ statuses: [...UI_COMPONENT_UNSYNCED_STATUSES] })} />
            <SummaryFilterCard label="Merged Commits" value={summary.merged}
              infoId="ui-components-merged-info" infoAlign="end"
              infoText="The exact commit SHA appears in a merged ui-components main PR, or an author/admin has confirmed a match to a merged PR."
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              cardClassName="border-emerald-200 bg-emerald-50/40" labelClassName="text-emerald-600" valueClassName="text-emerald-600" activeClassName="ring-emerald-400"
              active={sameUiComponentStatuses(statuses, ["MERGED"])} onSelect={() => updateView({ statuses: ["MERGED"] })} />
            <SummaryFilterCard label="Approved Commits" value={summary.approved}
              infoId="ui-components-approved-info" infoAlign="end"
              infoText="The commit author or an admin manually approved this release commit. Approved commits are excluded from the unsynced total; approval does not mean a main PR was merged."
              icon={<CheckCircle2 className="h-4 w-4 text-teal-500" />}
              cardClassName="border-teal-200 bg-teal-50/40" labelClassName="text-teal-600" valueClassName="text-teal-600" activeClassName="ring-teal-400"
              active={sameUiComponentStatuses(statuses, ["APPROVED"])} onSelect={() => updateView({ statuses: ["APPROVED"] })} />
          </div>

          <DashboardRiskLeaderboard title="🏆 Top Risk Contributors — Unsynced Commits"
            entries={summary.contributors} selected={view.author} unit="commit" emptyMessage="All release commits are synced or approved."
            filterLabel="Filter by unsynced author"
            onSelect={(author) => updateView({ query: "", author, branch: "", statuses: [...UI_COMPONENT_UNSYNCED_STATUSES] })} />
          <DashboardRiskLeaderboard title="Top Release Branches — Unsynced Commits"
            entries={summary.branches} selected={branch} unit="commit" monospace emptyMessage="All release branches are synced."
            filterLabel="Filter by unsynced release branch"
            onSelect={(branch) => updateView({ query: "", author: "", branch, statuses: [...UI_COMPONENT_UNSYNCED_STATUSES] })} />

          <UiComponentListFilters view={view} authors={authors} branches={data.branches.map((item) => item.branch)} total={filtered.length} onChange={updateView} onReload={reload} loading={loading} />

          <section aria-label="Release commits" className="overflow-hidden rounded-xl border border-blue-100 bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">Release commits and their main PR matches. Expand a commit to see patch scores and review actions.</caption>
                <thead><tr className="border-b border-blue-100 bg-blue-50/60 text-left text-xs font-semibold uppercase tracking-wider text-blue-600">
                  {['Status', 'Commit', 'Title', 'Author', 'Release Branch', 'Main PR', 'Committed'].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-blue-50">
                  {rows.map((commit) => <Fragment key={commit.sha}>
                    <CommitTableRow commit={commit} expanded={expandedSha === commit.sha} onToggle={() => toggleDetails(commit.sha)} onAuthor={applyAuthorFilter} onBranch={applyBranchFilter} />
                    {expandedSha === commit.sha && <tr><td colSpan={7} className="bg-blue-50/20 p-4">
                      <CommitDetails commit={commit} runId={data.runId!} canReview={data.reviewsAvailable && canReviewUiComponentCommit(reviewAccess, commit.authorEmail)} onReviewed={reloadAfterReview} />
                    </td></tr>}
                  </Fragment>)}
                  {!rows.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-blue-400">{statuses.length === 0 ? "No statuses selected. Choose a status in Filters to show release commits." : selectedBranch?.status === "published-version" ? "This branch uses a published version and has no custom release commits." : "No release commits match these filters."}</td></tr>}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && <div className="flex items-center justify-between border-t border-blue-50 bg-blue-50/40 px-4 py-3 text-xs text-blue-500">
              <span>Page <strong className="text-blue-800">{currentPage}</strong> of <strong className="text-blue-800">{pageCount}</strong></span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setView((current) => ({ ...current, page: currentPage - 1 }))} className="rounded-lg border border-blue-100 bg-surface p-1.5 text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
                <button type="button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setView((current) => ({ ...current, page: currentPage + 1 }))} className="rounded-lg border border-blue-100 bg-surface p-1.5 text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
              </div>
            </div>}
          </section>
          <details className="rounded-xl border border-blue-100 bg-surface shadow-sm">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-blue-800">Dependency details · {data.branches.length} hyper-widget release branches · {data.branches.filter((item) => item.status === "published-version").length} published versions · {data.mainPrCount} main PRs imported</summary>
            <div className="max-h-96 overflow-auto border-t border-blue-100">
              {data.branches.map((item) => <div key={item.branch} className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-4 py-3 text-xs">
                <div className="min-w-0 flex-1"><button type="button" onClick={() => applyBranchFilter(item.branch)} className="font-semibold text-blue-700 underline-offset-4 hover:underline">{item.branch}</button>
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
          <p className="text-xs leading-relaxed text-blue-400">Exact commit matches establish PR membership. Patch scores compare files and added/removed lines; even a 100% score needs review. Sign in as the commit author or an admin to confirm a match or approve a commit. {data.mainPrFingerprintUnavailable > 0 ? `${data.mainPrFingerprintUnavailable} main PR fingerprints are unavailable, so patch suggestions may be incomplete.` : ""}</p>
        </>}
        {!data?.runId && <button type="button" onClick={reload} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-surface px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Reload results</button>}
      </main>
    </div>
  );
}

function CommitTableRow({ commit, expanded, onToggle, onAuthor, onBranch }: {
  commit: UiComponentDashboardCommit; expanded: boolean; onToggle: () => void;
  onAuthor: (author: string) => void; onBranch: (branch: string) => void;
}) {
  return <tr data-commit-sha={commit.sha} className={`cursor-pointer transition hover:bg-blue-50/40 ${expanded ? "bg-blue-50/40" : ""}`} onClick={(event) => {
    if (!(event.target instanceof Element) || !event.target.closest("a, button")) onToggle();
  }}>
    <td className="px-4 py-3"><CommitStatusBadge status={commit.matchStatus} /></td>
    <td className="px-4 py-3 font-mono text-xs text-slate-600">
      <a href={`${repoUrl("ui-components")}/commits/${commit.sha}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">{commit.sha.slice(0, 12)}<ExternalLink aria-hidden="true" className="h-3 w-3" /></a>
    </td>
    <td className="max-w-xs px-4 py-3 text-slate-800">
      <button type="button" aria-label={`${expanded ? "Hide" : "View"} details for commit ${commit.sha.slice(0, 12)}`} aria-expanded={expanded} aria-controls={`commit-details-${commit.sha}`}
        onClick={onToggle} className="flex w-full items-start gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
        <span className="line-clamp-2" title={commit.message}>{commit.message.split("\n")[0] || "Untitled commit"}</span>
        <ChevronDown aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400 transition ${expanded ? "rotate-180" : ""}`} />
      </button>
    </td>
    <td className="px-4 py-3 text-blue-800"><button type="button" onClick={() => onAuthor(commit.authorName)} aria-label={`Filter by author ${commit.authorName}`} className="max-w-44 break-words text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">{commit.authorName}</button></td>
    <td className="px-4 py-3 font-mono text-xs text-blue-500"><div className="space-y-1">{commit.branches.map((branch) => <button type="button" key={branch} onClick={() => onBranch(branch)} aria-label={`Filter by release branch ${branch}`} className="block text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">{branch}</button>)}</div></td>
    <td className="px-4 py-3"><div className="space-y-1.5">{commit.matches.slice(0, 2).map((match) => <div key={match.prId}>
      <div className="flex items-center gap-1.5"><a href={`${repoUrl("ui-components")}/pull-requests/${match.prId}/overview`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline">#{match.prId}<ExternalLink aria-hidden="true" className="h-3 w-3" /></a><StatusBadge status={match.state} /></div>
      {match.reason === "patch-similarity" && <span className="text-[11px] text-orange-700">Suggestion · {Math.round((match.score ?? 0) * 100)}%</span>}
    </div>)}</div>{!commit.matches.length && <span className="text-xs text-slate-400">—</span>}{commit.matches.length > 2 && <button type="button" onClick={onToggle} className="mt-1 text-xs text-blue-600 hover:underline">{expanded ? "Hide details" : `+${commit.matches.length - 2} more matches`}</button>}</td>
    <td className="whitespace-nowrap px-4 py-3 text-xs text-blue-400">{commit.authorTimestamp ? new Date(commit.authorTimestamp).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : <span className="text-slate-300">—</span>}</td>
  </tr>;
}

function CommitStatusBadge({ status }: { status: UiComponentMatchStatus }) {
  if (status === "MERGED" || status === "APPROVED") return <StatusBadge status={status} />;
  if (status === "OPEN_PR") return <StatusBadge status="OPEN" />;
  const colors = status === "NEEDS_REVIEW" ? "bg-orange-100 text-orange-700" : status === "UNMATCHED" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600";
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${colors}`}><AlertTriangle aria-hidden="true" className="h-3 w-3" />{statusLabels[status]}</span>;
}

function CommitDetails({ commit, runId, canReview, onReviewed }: {
  commit: UiComponentDashboardCommit; runId: string; canReview: boolean; onReviewed: () => Promise<void>;
}) {
  return <div id={`commit-details-${commit.sha}`} role="region" aria-label={`Details for commit ${commit.sha.slice(0, 12)}`} className="grid gap-6 lg:grid-cols-2">
    <div className="min-w-0">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-blue-800"><GitCommitHorizontal aria-hidden="true" className="h-4 w-4" />Commit details</h2>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{commit.message || "Untitled commit"}</p>
      <p className="mt-2 break-all font-mono text-xs text-blue-500">{commit.sha}</p>
      <p className="mt-1 text-xs text-blue-500">{commit.authorEmail || commit.authorName}{commit.authorTimestamp ? ` · ${new Date(commit.authorTimestamp).toLocaleString("en-IN")}` : ""}</p>
      {commit.review && <p className="mt-2 break-words text-[11px] text-blue-500">{commit.review.approved ? "Manually approved" : "Review updated"} by {commit.review.updatedBy} · {new Date(commit.review.updatedAt).toLocaleString()}{commit.review.mainPrId ? ` · Confirmed main PR #${commit.review.mainPrId}` : ""}</p>}
      {commit.reviewWarning && <p className="mt-2 text-xs text-orange-700">{commit.reviewWarning}</p>}
      {canReview && <UiComponentReviewControls commit={commit} runId={runId} onUpdated={onReviewed} />}
    </div>
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-blue-800">Main PR matches</h2>
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
  </div>;
}
