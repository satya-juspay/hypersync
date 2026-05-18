"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Search,
  ExternalLink,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { StatusBadge } from "@/components/status-badge";
import { prUrl } from "@/lib/bitbucket";
import type { ReleasePR } from "@/lib/types";

const REPO = "hyper-widget";
const CACHE_TTL = 30_000; // ms
let _cache: { data: ReleasePR[]; ts: number } | null = null;

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<ReleasePR[]>(_cache?.data ?? []);
  const [loading, setLoading] = useState(_cache === null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const fetchData = useCallback((force = false) => {
    if (!force && _cache && Date.now() - _cache.ts < CACHE_TTL) {
      setData(_cache.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch("/api/release-prs")
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Unknown error");
        _cache = { data: json.data, ts: Date.now() };
        setData(json.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Metrics
  const total = data.length;
  const unsynced = data.filter((p) => p.syncStatus !== "SYNCED").length;
  const synced = data.filter((p) => p.syncStatus === "SYNCED").length;

  // Risk leaderboard — top 3 authors with most unsynced PRs
  const riskMap: Record<string, number> = {};
  data
    .filter((p) => p.syncStatus !== "SYNCED")
    .forEach((p) => {
      riskMap[p.author] = (riskMap[p.author] || 0) + 1;
    });
  const leaderboard = Object.entries(riskMap)
    .sort((a, b) => b[1] - a[1]);

  // Search filter
  const filtered = data.filter((p) => {
    const q = query.toLowerCase();
    return (
      p.id.includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q) ||
      p.releaseBranch.toLowerCase().includes(q)
    );
  });

  const rankColors = [
    "from-red-500 to-red-400",
    "from-orange-500 to-amber-400",
    "from-amber-400 to-yellow-300",
    "from-blue-500 to-blue-400",
    "from-violet-500 to-violet-400",
  ];

  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <Navbar onRefresh={() => fetchData(true)} refreshing={loading} />

      <main className="mx-auto max-w-7xl px-6 py-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* SECTION 2 — SUMMARY CARDS */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-blue-500">Total Release PRs</p>
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
            <p className="mt-2 text-4xl font-bold text-blue-900">{total}</p>
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-red-600">Unsynced PRs</p>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <p className="mt-2 text-4xl font-bold text-red-600">{unsynced}</p>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-emerald-600">Synced Master PRs</p>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-4xl font-bold text-emerald-600">{synced}</p>
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

        {/* SECTION 4 — SEARCH */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by PR ID, title, author, branch…"
              className="w-full rounded-lg border border-blue-200 bg-white py-2 pl-9 pr-4 text-sm text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {!loading && (
            <p className="shrink-0 text-xs text-blue-400">
              Showing <strong className="text-blue-700">{filtered.length}</strong> of{" "}
              <strong className="text-blue-700">{total}</strong> PRs
            </p>
          )}
        </div>

        {/* SECTION 5 — MASTER DATA TABLE */}
        <div className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
          {loading ? (
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
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-12 text-center text-blue-300"
                    >
                      No PRs match your search.
                    </td>
                  </tr>
                ) : (
                  filtered.map((pr) => (
                    <tr
                      key={pr.id}
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
        </div>
      </main>
    </div>
  );
}


