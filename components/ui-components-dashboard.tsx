"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, GitBranch, GitCommitHorizontal, Info, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { Navbar } from "@/components/navbar";
import type { UiComponentDashboard, UiComponentDashboardCommit, UiComponentMatchStatus } from "@/lib/ui-component-types";

const statusLabels: Record<UiComponentMatchStatus, string> = {
  MERGED: "Merged to main", OPEN_PR: "Open main PR", NEEDS_REVIEW: "Needs review", UNMATCHED: "No match", UNAVAILABLE: "Analysis unavailable",
};
const statusColors: Record<UiComponentMatchStatus, string> = {
  MERGED: "bg-emerald-50 text-emerald-700 border-emerald-200", OPEN_PR: "bg-blue-50 text-blue-700 border-blue-200",
  NEEDS_REVIEW: "bg-orange-100 text-orange-700 border-orange-100", UNMATCHED: "bg-red-50 text-red-700 border-red-200",
  UNAVAILABLE: "bg-slate-50 text-slate-600 border-slate-200",
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
  const [data, setData] = useState<UiComponentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<UiComponentMatchStatus | "ALL">("ALL");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    loadDashboard(controller.signal).then(setData).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load UI Components");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function reload() {
    setLoading(true);
    setError(null);
    try { setData(await loadDashboard()); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load UI Components"); }
    finally { setLoading(false); }
  }

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (data?.commits ?? []).filter((commit) => (!branch || commit.branches.includes(branch)) && (status === "ALL" || commit.matchStatus === status)
      && (!search || [commit.sha, commit.message, commit.authorName, ...commit.branches, ...commit.matches.map((match) => `#${match.prId} ${match.title}`)].some((text) => text.toLowerCase().includes(search))));
  }, [data, branch, status, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const selectedBranch = data?.branches.find((item) => item.branch === branch);
  const summary = [
    { label: "Release commits", count: data?.commits.length ?? 0, status: "ALL" as const, description: "Unique custom ui-components commits across all discovered 2026 hyper-widget release branches. Jenkins commits are excluded." },
    { label: "Merged to main", count: data?.commits.filter((commit) => commit.matchStatus === "MERGED").length ?? 0, status: "MERGED" as const, description: "The exact commit SHA appears in a merged ui-components main PR." },
    { label: "Open main PRs", count: data?.commits.filter((commit) => commit.matchStatus === "OPEN_PR").length ?? 0, status: "OPEN_PR" as const, description: "The exact commit SHA appears in an open main PR and has no merged main PR match." },
    { label: "Needs review", count: data?.commits.filter((commit) => commit.matchStatus === "NEEDS_REVIEW").length ?? 0, status: "NEEDS_REVIEW" as const, description: "A similar patch or a declined PR contains this work. Patch similarity is a suggestion that needs review." },
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
          {data.analysisVersion === 0 && <div role="status" className="rounded-xl border border-orange-100 bg-orange-100 p-4 text-sm text-orange-700">This snapshot contains dependency histories only. Run the updated <code>npm run refresh:ui-components</code> from the office network to add main PR matches.</div>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.map((item) => <button key={item.label} onClick={() => { setStatus(item.status); setPage(1); }} aria-pressed={status === item.status}
              className={`rounded-xl border bg-surface p-4 text-left shadow-sm transition hover:border-blue-400 ${status === item.status ? "border-blue-400 ring-1 ring-blue-200" : "border-blue-100"}`}>
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-blue-500">{item.label}<Info aria-label={item.description} className="h-4 w-4 shrink-0"><title>{item.description}</title></Info></span>
              <span className="mt-2 block text-3xl font-bold">{item.count}</span>
            </button>)}
          </div>

          <details className="rounded-xl border border-blue-100 bg-surface shadow-sm">
            <summary className="cursor-pointer px-4 py-4 text-sm font-semibold">{data.branches.length} hyper-widget release branches · {data.branches.filter((item) => item.status === "published-version").length} published versions · {data.mainPrCount} main PRs imported</summary>
            <div className="max-h-96 overflow-auto border-t border-blue-100">
              {data.branches.map((item) => <div key={item.branch} className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-50 px-4 py-3 text-xs">
                <div className="min-w-0 flex-1"><button onClick={() => { setBranch(item.branch); setStatus("ALL"); setPage(1); }} className="font-semibold text-blue-700 underline-offset-4 hover:underline">{item.branch}</button>
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

          <section aria-label="Release commit filters" className="flex flex-wrap gap-3 rounded-xl border border-blue-100 bg-surface p-4 shadow-sm">
            <label className="relative min-w-48 flex-1"><span className="sr-only">Search commits or main PRs</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-blue-400" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search commit, author or main PR…" className="w-full rounded-lg border border-blue-100 bg-background py-2 pl-9 pr-3 text-sm" />
            </label>
            <label><span className="sr-only">Release branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }} className="max-w-full rounded-lg border border-blue-100 bg-background px-3 py-2 text-sm">
              <option value="">All release branches</option>{data.branches.map((item) => <option key={item.branch}>{item.branch}</option>)}
            </select></label>
            <label><span className="sr-only">Match status</span><select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} className="rounded-lg border border-blue-100 bg-background px-3 py-2 text-sm">
              <option value="ALL">All match statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </section>

          <section aria-label="Release commits" className="overflow-hidden rounded-xl border border-blue-100 bg-surface shadow-sm">
            <div className="border-b border-blue-100 px-4 py-3 text-sm font-semibold">{filtered.length} unique release commits{branch ? ` · ${branch}` : ""}</div>
            {rows.map((commit) => <CommitRow key={commit.sha} commit={commit} onBranch={(value) => { setBranch(value); setStatus("ALL"); setPage(1); }} />)}
            {!rows.length && <p className="px-4 py-10 text-center text-sm text-blue-500">{selectedBranch?.status === "published-version" ? "This branch uses a published version and has no custom release commits." : "No release commits match these filters."}</p>}
            {filtered.length > 20 && <div className="flex items-center justify-between border-t border-blue-100 px-4 py-3 text-xs text-blue-500">
              <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded border border-blue-100 px-3 py-1.5 disabled:opacity-40">Previous</button>
              <span>Page {currentPage} of {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="rounded border border-blue-100 px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>}
          </section>
          <p className="text-xs leading-relaxed text-blue-400">Exact commit matches establish PR membership. Patch scores compare files and added/removed lines; even a 100% score needs review. {data.mainPrFingerprintUnavailable > 0 ? `${data.mainPrFingerprintUnavailable} main PR fingerprints are unavailable, so patch suggestions may be incomplete.` : ""}</p>
        </>}
      </main>
    </div>
  );
}

function CommitRow({ commit, onBranch }: { commit: UiComponentDashboardCommit; onBranch: (branch: string) => void }) {
  return <article className="grid gap-4 border-b border-blue-50 p-4 lg:grid-cols-2">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><a href={`${repoUrl("ui-components")}/commits/${commit.sha}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-blue-600"><GitCommitHorizontal className="h-4 w-4" />{commit.sha.slice(0, 12)}<ExternalLink className="h-3 w-3" /></a>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColors[commit.matchStatus]}`}>{statusLabels[commit.matchStatus]}</span>
      </div>
      <p className="mt-2 break-words text-sm font-semibold" title={commit.message}>{commit.message.split("\n")[0] || "Untitled commit"}</p>
      <p className="mt-1 break-all text-xs text-blue-500">{commit.authorName}{commit.authorTimestamp ? ` · ${new Date(commit.authorTimestamp).toLocaleDateString()}` : ""}</p>
      <div className="mt-2 flex flex-wrap gap-1">{commit.branches.map((branch) => <button key={branch} onClick={() => onBranch(branch)} className="rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-600 hover:underline">{branch}</button>)}</div>
    </div>
    <div className="space-y-2">
      {commit.matches.map((match) => <div key={match.prId} className="rounded-lg border border-blue-100 bg-background px-3 py-2">
        <a href={`${repoUrl("ui-components")}/pull-requests/${match.prId}/overview`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">#{match.prId} · {match.title} <ExternalLink className="inline h-3 w-3" /></a>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-blue-500"><span className={`rounded border px-1.5 py-0.5 ${match.state === "MERGED" ? "border-emerald-200 text-emerald-700" : match.state === "OPEN" ? "border-blue-200 text-blue-700" : "border-red-200 text-red-700"}`}>{match.state}</span>
          <span>{match.reason === "exact-commit" ? "Exact commit SHA" : `Patch suggestion · ${Math.round((match.score ?? 0) * 100)}%`}</span>
        </div>
        {match.reason === "patch-similarity" && <p className="mt-1 text-[11px] text-blue-400">Files {match.matchedFiles}/{match.totalFiles} · Added {match.matchedAddedLines}/{match.totalAddedLines} · Removed {match.matchedRemovedLines}/{match.totalRemovedLines}</p>}
      </div>)}
      {!commit.matches.length && <p className="text-xs text-blue-400">{commit.matchStatus === "UNAVAILABLE" ? "Patch analysis unavailable; no exact commit match found." : "No corresponding main PR found in the imported 2026 dataset."}</p>}
      {commit.fingerprintError && <p className="text-xs text-orange-700">{commit.fingerprintStatus === "SKIPPED_500" ? "Diff skipped after a recorded HTTP 500. " : ""}{commit.fingerprintError}</p>}
    </div>
  </article>;
}
