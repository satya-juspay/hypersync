"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Search, Target } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { PatchScore } from "@/lib/patch-score";
import type { ReleasePRStatus } from "@/types/hypersync";

type MainPRStatus = Extract<
  ReleasePRStatus,
  "OPEN" | "MERGED" | "DECLINED"
>;

type PatchMatch = PatchScore & {
  title: string;
  author: string;
  displayName: string;
  status: MainPRStatus;
  mergedAt: string | null;
  bitbucketUrl: string;
};

type Props = {
  releasePrId: string;
  currentMainPrId: string | null;
  onUpdated?: () => void | Promise<void>;
};

type MatchesResponse = {
  success: boolean;
  ticketNumber?: string;
  searched?: number;
  matches?: PatchMatch[];
  error?: string;
};

export function PatchMatchSearch({
  releasePrId,
  currentMainPrId,
  onUpdated,
}: Props) {
  const [matches, setMatches] = useState<PatchMatch[] | null>(null);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [searched, setSearched] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingMainPrId, setSavingMainPrId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sync/${releasePrId}/matches`, {
        cache: "no-store",
      });
      const json = (await response.json()) as MatchesResponse;

      if (!response.ok || !json.success) {
        throw new Error(json.error ?? "Failed to search patch matches");
      }

      setMatches(json.matches ?? []);
      setTicketNumber(json.ticketNumber ?? null);
      setSearched(json.searched ?? 0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to search patch matches"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleUseMatch(mainPrId: string) {
    setSavingMainPrId(mainPrId);
    setError(null);

    try {
      const response = await fetch(`/api/sync/${releasePrId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mainPrId }),
      });
      const json = (await response.json()) as { success: boolean; error?: string };

      if (!response.ok || !json.success) {
        throw new Error(json.error ?? "Failed to update main PR");
      }

      await onUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update main PR");
    } finally {
      setSavingMainPrId(null);
    }
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-blue-900">
            Patch Score Matches
          </h2>
          <p className="mt-1 text-xs text-blue-400">
            Scores main PRs with the same devqa ticket on the server.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-surface px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Search Main PRs
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {matches === null ? (
        <div className="rounded-lg border border-blue-50 bg-blue-50/40 px-4 py-3 text-sm text-blue-500">
          Run a patch score search to find likely main PRs.
        </div>
      ) : matches.length === 0 ? (
        <div className="rounded-lg border border-blue-50 bg-blue-50/40 px-4 py-3 text-sm text-blue-500">
          No main PRs scored above 60% across {searched} candidates
          {ticketNumber ? ` for ticket ${ticketNumber}` : ""}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-blue-100">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-blue-100 bg-blue-50/60 text-left text-xs font-semibold uppercase tracking-wider text-blue-500">
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Main PR</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Overlap</th>
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-50">
              {matches.map((match) => (
                <tr key={match.mainPrId}>
                  <td className="px-4 py-3 font-semibold text-blue-900">
                    {(match.score * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <a
                      href={match.bitbucketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      #{match.mainPrId}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={match.status} />
                  </td>
                  <td className="max-w-xs px-4 py-3 text-slate-800">
                    <span className="line-clamp-2">{match.title}</span>
                  </td>
                  <td className="px-4 py-3 text-blue-800">{match.author}</td>
                  <td className="px-4 py-3 text-xs text-blue-500">
                    {match.matchedFiles}/{match.totalFiles} files,{" "}
                    {match.matchedAddedLines}/{match.totalAddedLines} added,{" "}
                    {match.matchedRemovedLines}/{match.totalRemovedLines} removed
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void handleUseMatch(match.mainPrId)}
                      disabled={
                        savingMainPrId !== null ||
                        currentMainPrId === match.mainPrId
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-surface px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingMainPrId === match.mainPrId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Target className="h-3.5 w-3.5" />
                      )}
                      {currentMainPrId === match.mainPrId ? "Current" : "Use"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
