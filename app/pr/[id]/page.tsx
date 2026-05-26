"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Calendar, ExternalLink, GitBranch, Loader2, User } from "lucide-react";
import { EditPRButton } from "@/components/edit-pr-button";
import { Navbar } from "@/components/navbar";
import { PatchMatchSearch } from "@/components/patch-match-search";
import { StatusBadge } from "@/components/status-badge";
import { prUrl } from "@/lib/bitbucket";
import { syncAndLoad, useHyperSyncStore } from "@/lib/hypersync-store";

const REPO = "hyper-widget";

type AdminAccess = {
  email: string | null;
  isAuthenticated: boolean;
  canEditAnyPR: boolean;
};

type AdminMeResponse = {
  success: boolean;
  access?: AdminAccess;
  error?: string;
};

function fmt(date: null | string | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

function MetaCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium text-blue-900">{children}</div>
    </div>
  );
}

export default function PRDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { releasePRs, syncStatus, loading, refreshing, initialized, error } =
    useHyperSyncStore();
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized && !loading && !refreshing) {
      void syncAndLoad({ quick: true });
    }
  }, [initialized, loading, refreshing]);

  useEffect(() => {
    let disposed = false;

    async function loadAccess() {
      setAccessLoading(true);
      setAccessError(null);

      try {
        const response = await fetch("/api/admins/me", { cache: "no-store" });
        const json = (await response.json()) as AdminMeResponse;

        if (!response.ok || !json.success || !json.access) {
          throw new Error(json.error ?? "Failed to load access");
        }

        if (!disposed) {
          setAccess(json.access);
        }
      } catch (err) {
        if (!disposed) {
          setAccessError(
            err instanceof Error ? err.message : "Failed to load access"
          );
          setAccess(null);
        }
      } finally {
        if (!disposed) {
          setAccessLoading(false);
        }
      }
    }

    void loadAccess();

    return () => {
      disposed = true;
    };
  }, []);

  const pr = useMemo(
    () => releasePRs.find((releasePR) => releasePR.id === id) ?? null,
    [id, releasePRs]
  );
  const canEdit = Boolean(
    pr &&
      access?.isAuthenticated &&
      (access.canEditAnyPR ||
        normalizeEmail(access.email) === normalizeEmail(pr.author))
  );
  const loadingPage =
    (!initialized && releasePRs.length === 0 && !error) || accessLoading;

  if (loadingPage) {
    return <PRDetailLoadingView />;
  }

  if (!pr) {
    return (
      <div className="min-h-screen bg-[#f0f4ff]">
        <Navbar backHref="/" lastSyncedAt={syncStatus.lastSyncedAt} />
        <main className="mx-auto max-w-5xl px-6 py-5">
          <div className="rounded-lg border border-blue-100 bg-white p-6 text-sm font-medium text-blue-900 shadow-sm">
            PR #{id} was not found in the current sync data.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <Navbar backHref="/" lastSyncedAt={syncStatus.lastSyncedAt} />

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        {(error || accessError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error ?? accessError}
          </div>
        )}

        <div className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <StatusBadge status={pr.syncStatus} />
            <a
              href={pr.bitbucketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-sm text-blue-600 hover:underline"
            >
              #{pr.id}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {pr.mainPrId && (
              <span className="text-xs text-blue-400">
                Main PR:{" "}
                <a
                  href={prUrl(REPO, pr.mainPrId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  #{pr.mainPrId}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl font-bold leading-snug text-blue-900">
              {pr.title}
            </h1>
            {canEdit && (
              <EditPRButton
                prId={pr.id}
                currentMainPrId={pr.mainPrId ?? null}
                currentUpdatedStatus={pr.updatedStatus ?? null}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetaCard icon={<User className="h-3.5 w-3.5" />} label="Author">
            {pr.author}
          </MetaCard>
          <MetaCard
            icon={<GitBranch className="h-3.5 w-3.5" />}
            label="Release Branch"
          >
            <span className="font-mono text-xs">{pr.releaseBranch}</span>
          </MetaCard>
          <MetaCard
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Merged At"
          >
            {fmt(pr.mergedAt)}
          </MetaCard>
          <MetaCard icon={<User className="h-3.5 w-3.5" />} label="Updated By">
            {pr.updatedBy ?? "-"}
          </MetaCard>
          <MetaCard
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Updated At"
          >
            {fmt(pr.updatedAt)}
          </MetaCard>
        </div>

        {canEdit && (
          <PatchMatchSearch
            releasePrId={pr.id}
            currentMainPrId={pr.mainPrId ?? null}
            releasePatchFingerprint={pr.patchFingerprint ?? null}
          />
        )}
      </main>
    </div>
  );
}

function PRDetailLoadingView() {
  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <Navbar backHref="/" />

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        <div className="animate-pulse rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex gap-3">
            <div className="h-6 w-24 rounded-full bg-blue-100" />
            <div className="h-6 w-16 rounded bg-blue-100" />
          </div>
          <div className="h-7 w-3/4 rounded bg-blue-100" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-xl border border-blue-100 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 h-3 w-24 rounded bg-blue-100" />
              <div className="h-5 w-2/3 rounded bg-blue-100" />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-blue-100 bg-white p-5 text-center text-sm text-blue-500 shadow-sm">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Loading PR data
        </div>
      </main>
    </div>
  );
}
