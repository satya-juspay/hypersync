"use client";

import { useState } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import type { UiComponentDashboardCommit, UiComponentReviewRequest } from "@/lib/ui-component-types";

export function UiComponentReviewControls({ commit, runId, onUpdated }: {
  commit: UiComponentDashboardCommit;
  runId: string;
  onUpdated: () => Promise<void>;
}) {
  const [mainPrId, setMainPrId] = useState(commit.review?.mainPrId?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `review-main-pr-${commit.sha}`;

  async function save(action: UiComponentReviewRequest["action"]) {
    setError(null);
    if (action === "confirm" && (!/^[1-9]\d*$/.test(mainPrId.trim()) || Number(mainPrId) > 2_147_483_647)) {
      setError("Enter a positive main PR ID.");
      return;
    }
    setSaving(true);
    try {
      const body: UiComponentReviewRequest = action === "confirm" ? { runId, action, mainPrId: Number(mainPrId) } : { runId, action };
      const response = await fetch(`/api/ui-components/commits/${commit.sha}/review`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Could not save the review");
      await onUpdated().catch(() => { throw new Error("Review saved, but results could not reload. Use Reload results to see the update."); });
      if (action === "clear-match") setMainPrId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the review");
    } finally { setSaving(false); }
  }

  return <details className="mt-3 rounded-lg border border-blue-100 bg-background text-xs" onToggle={(event) => {
    if (event.currentTarget.open) { setMainPrId(commit.review?.mainPrId?.toString() ?? ""); setError(null); }
  }}>
    <summary className="cursor-pointer px-3 py-2 font-semibold text-blue-700"><Pencil aria-hidden="true" className="mr-1 inline h-3 w-3" />Review commit</summary>
    <div className="space-y-3 border-t border-blue-100 p-3" aria-busy={saving}>
      <p className="leading-relaxed text-blue-500">Confirm that a main PR contains this work, or approve the commit manually. Decisions apply to this commit in every release branch and survive refreshes.</p>
      <div>
        <label htmlFor={inputId} className="mb-1 block font-semibold text-blue-700">Main PR ID</label>
        <div className="flex flex-wrap gap-2">
          <input id={inputId} inputMode="numeric" value={mainPrId} disabled={saving} onChange={(event) => setMainPrId(event.target.value)}
            placeholder="e.g. 1201" className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50" />
          <button type="button" disabled={saving || !mainPrId.trim()} onClick={() => void save("confirm")} className="rounded-lg border border-blue-200 bg-surface px-3 py-2 font-semibold text-blue-700 disabled:opacity-50">Confirm match</button>
        </div>
        {commit.matches.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 text-blue-500"><span>Choose a listed PR:</span>{commit.matches.map((match) =>
          <button key={match.prId} type="button" disabled={saving} onClick={() => setMainPrId(String(match.prId))} className="rounded border border-blue-200 bg-surface px-2 py-1 font-semibold text-blue-700 disabled:opacity-50">#{match.prId}</button>
        )}</div>}
        <p className="mt-2 leading-relaxed text-blue-400">The PR must be in the current ui-components import. Confirmation uses its current status and replaces manual approval.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => void save(commit.review?.approved ? "unapprove" : "approve")}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-700 disabled:opacity-50">{commit.review?.approved ? "Remove approval" : "Mark as approved"}</button>
        {commit.review?.mainPrId && <button type="button" disabled={saving} onClick={() => void save("clear-match")} className="rounded-lg border border-blue-200 bg-surface px-3 py-2 font-semibold text-blue-700 disabled:opacity-50">Clear confirmed match</button>}
        {saving && <span role="status" className="inline-flex items-center gap-1 text-blue-500"><LoaderCircle aria-hidden="true" className="h-3 w-3 animate-spin" />Saving review…</span>}
      </div>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </details>;
}
