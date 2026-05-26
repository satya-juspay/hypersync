"use client";

import { useState } from "react";
import { Pencil, X, Save, ThumbsUp, ThumbsDown, Trash2, Loader2 } from "lucide-react";
import {
  invalidateSyncResponseCache,
  syncAndLoad,
} from "@/lib/hypersync-store";

type Props = {
  prId: string;
  currentMainPrId: string | null;
  currentUpdatedStatus: string | null;
};

export function EditPRButton({ prId, currentMainPrId, currentUpdatedStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [mainPrId, setMainPrId] = useState(currentMainPrId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { mainPrId?: string | null; updatedStatus?: string | null }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sync/${prId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to save");
      invalidateSyncResponseCache();
      await syncAndLoad({ quick: true, force: true });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveMainPr() {
    void patch({ mainPrId: mainPrId.trim() || null });
  }

  function handleApprove() {
    void patch({ updatedStatus: "APPROVED" });
  }

  function handleClearMainPr() {
    setMainPrId("");
    void patch({ mainPrId: null });
  }

  function handleUnapprove() {
    void patch({ updatedStatus: null });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative z-50 w-full max-w-sm rounded-xl border border-blue-100 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-blue-900">Edit PR #{prId}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-blue-300 transition hover:bg-blue-50 hover:text-blue-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Main PR ID */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">
                Main PR ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mainPrId}
                  onChange={(e) => setMainPrId(e.target.value)}
                  placeholder="e.g. 4821"
                  className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={handleSaveMainPr}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Save
                </button>
                {currentMainPrId && (
                  <button
                    type="button"
                    onClick={handleClearMainPr}
                    disabled={saving}
                    title="Remove main PR link"
                    className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-semibold text-red-600 shadow-sm transition hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="mb-5 flex items-center gap-2 text-xs text-blue-300">
              <div className="h-px flex-1 bg-blue-100" />
              or
              <div className="h-px flex-1 bg-blue-100" />
            </div>

            {/* Approve / Unapprove */}
            {currentUpdatedStatus === "APPROVED" ? (
              <button
                type="button"
                onClick={handleUnapprove}
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ThumbsDown className="h-4 w-4" />
                )}
                Remove Approval
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApprove}
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ThumbsUp className="h-4 w-4" />
                )}
                Mark as Approved
              </button>
            )}

            {error && (
              <p className="mt-3 text-xs text-red-600">{error}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
