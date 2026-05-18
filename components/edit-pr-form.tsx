"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { Pencil, X, Check, Loader2, RefreshCw, Trash2 } from "lucide-react";

const SYNC_STATUSES = [
  { value: "SYNCED", label: "Synced" },
  { value: "MAIN_PR_OPEN", label: "Main PR Open" },
  { value: "MISSING_MAIN_PR", label: "Missing Main PR" },
];

interface EditPRFormProps {
  id: string;
  currentSyncStatus: string;
  currentMainPrId: string | null;
}

export function EditPRForm({ id, currentSyncStatus, currentMainPrId }: EditPRFormProps) {
  const { isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState(currentSyncStatus);
  const [mainPrId, setMainPrId] = useState(currentMainPrId ?? "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [overrideMsg, setOverrideMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/release-prs/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Delete failed");
      window.location.href = "/";
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
      setDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleResync() {
    setResyncing(true);
    setResyncError(null);
    try {
      const res = await fetch("/api/pr-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: "hyper-widget", prId: id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Re-sync failed");
      window.location.reload();
    } catch (err: unknown) {
      setResyncError(err instanceof Error ? err.message : "Re-sync failed");
    } finally {
      setResyncing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`/api/release-prs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncStatus,
          mainPrId: mainPrId.trim() || null,
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Update failed");

      if (json.overridden) setOverrideMsg(json.overrideReason);
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        setOverrideMsg(null);
        window.location.reload();
      }, 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!open ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleResync}
            disabled={resyncing || currentSyncStatus === "SYNCED"}
            title={currentSyncStatus === "SYNCED" ? "Already synced" : "Re-fetch from Bitbucket and update status"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-sm font-medium text-blue-500 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resyncing ? "animate-spin" : ""}`} />
            {resyncing ? "Syncing…" : "Re-sync"}
          </button>
          {isSignedIn && (
            <>
              <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 shadow-sm transition hover:bg-blue-50"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit PR
              </button>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-500 shadow-sm transition hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Sure?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
                  >
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {deleting ? "Deleting…" : "Yes, delete"}
                  </button>
                  <button
                    onClick={() => { setDeleteConfirm(false); setDeleteError(null); }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {(resyncError || deleteError) && (
            <span className="text-xs text-red-500">{resyncError || deleteError}</span>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-blue-900">Edit PR Details</span>
            <button
              onClick={() => { setOpen(false); setError(null); }}
              className="text-blue-300 hover:text-blue-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Sync Status */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">
                Sync Status
              </label>
              <select
                value={syncStatus}
                onChange={(e) => setSyncStatus(e.target.value)}
                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                {SYNC_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Main PR ID */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">
                Main Branch PR ID
              </label>
              <input
                type="text"
                value={mainPrId}
                onChange={(e) => setMainPrId(e.target.value)}
                placeholder="e.g. 6995"
                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </p>
            )}

            {overrideMsg && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⚠ {overrideMsg}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null); }}
                className="rounded-lg px-4 py-1.5 text-sm text-blue-400 hover:text-blue-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || success}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : success ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                {saving ? "Saving…" : success ? "Saved!" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
