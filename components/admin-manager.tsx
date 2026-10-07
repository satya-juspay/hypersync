"use client";

import { useState } from "react";
import { Crown, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";

type AdminRecord = {
  email: string;
  createdAt: string;
  createdBy: string | null;
};

type Props = {
  initialAdmins: AdminRecord[];
  superAdminEmail: string;
  canRemoveAdmins: boolean;
};

type AdminMutationResponse = {
  success: boolean;
  data?: AdminRecord;
  error?: string;
};

export function AdminManager({
  initialAdmins,
  superAdminEmail,
  canRemoveAdmins,
}: Props) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();

    if (!nextEmail) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });
      const json = (await response.json()) as AdminMutationResponse;

      if (!response.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "Failed to add admin");
      }

      setAdmins((current) =>
        [...current.filter((admin) => admin.email !== json.data!.email), json.data!]
          .sort((a, b) => a.email.localeCompare(b.email))
      );
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add admin");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(adminEmail: string) {
    setRemovingEmail(adminEmail);
    setError(null);

    try {
      const response = await fetch(
        `/api/admins/${encodeURIComponent(adminEmail)}`,
        { method: "DELETE" }
      );
      const json = (await response.json()) as AdminMutationResponse;

      if (!response.ok || !json.success) {
        throw new Error(json.error ?? "Failed to remove admin");
      }

      setAdmins((current) =>
        current.filter((admin) => admin.email !== adminEmail)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove admin");
    } finally {
      setRemovingEmail(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Crown className="h-4 w-4 text-blue-500" />
          <h2 className="text-sm font-semibold text-blue-900">Super Admin</h2>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm font-medium text-blue-900">
          {superAdminEmail}
        </div>
      </div>

      <div className="rounded-lg border border-blue-100 bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-blue-900">Admins</h2>
          </div>
          <span className="text-xs font-semibold text-blue-400">
            {admins.length}
          </span>
        </div>

        <form onSubmit={handleAdd} className="mb-4 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="person@juspay.in"
            className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-surface px-3 py-2 text-sm text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={saving || !email.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </button>
        </form>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-lg border border-blue-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-blue-100 bg-blue-50/60 text-left text-xs font-semibold uppercase tracking-wider text-blue-500">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Added By</th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-50">
              {admins.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-blue-300">
                    No admins added.
                  </td>
                </tr>
              ) : (
                admins.map((admin) => (
                  <tr key={admin.email}>
                    <td className="px-4 py-3 font-medium text-blue-900">
                      {admin.email}
                    </td>
                    <td className="px-4 py-3 text-blue-500">
                      {formatDate(admin.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-blue-500">
                      {admin.createdBy ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canRemoveAdmins && (
                        <button
                          type="button"
                          onClick={() => void handleRemove(admin.email)}
                          disabled={removingEmail === admin.email}
                          title="Remove admin"
                          className="inline-flex rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 shadow-sm transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {removingEmail === admin.email ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
