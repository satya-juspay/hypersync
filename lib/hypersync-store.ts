"use client";

import { useSyncExternalStore } from "react";
import type {
  CachedPullRequest,
  ReleasePR,
  ReleasePRStatus,
  SyncStatus,
} from "@/types/hypersync";

export type DashboardStatusFilter = "ALL" | ReleasePRStatus;
export type DashboardSortOption =
  | "createdBy"
  | "mergedBy"
  | "mainPrMergedBy"
  | "releasePrMergedBy";
export type DashboardSortDirection = "asc" | "desc";
export type DashboardPageSize = 10 | 50 | 100;

export type DashboardViewState = {
  query: string;
  pageSize: DashboardPageSize;
  currentPage: number;
  statusFilter: DashboardStatusFilter;
  sortBy: DashboardSortOption;
  sortDirection: DashboardSortDirection;
};

type StoreState = {
  releasePRs: ReleasePR[];
  mainPRs: CachedPullRequest[];
  syncStatus: SyncStatus;
  dashboardView: DashboardViewState;
  loading: boolean;
  refreshing: boolean;
  initialized: boolean;
  error: string | null;
};

const initialSyncStatus: SyncStatus = {
  inProgress: false,
  processed: 0,
  total: 0,
};

const initialDashboardView: DashboardViewState = {
  query: "",
  pageSize: 10,
  currentPage: 1,
  statusFilter: "ALL",
  sortBy: "mergedBy",
  sortDirection: "asc",
};

let state: StoreState = {
  releasePRs: [],
  mainPRs: [],
  syncStatus: initialSyncStatus,
  dashboardView: initialDashboardView,
  loading: false,
  refreshing: false,
  initialized: false,
  error: null,
};

const listeners = new Set<() => void>();
let syncRequestId = 0;
let syncResponseCache: SyncApiResponse | null = null;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(nextState: Partial<StoreState>) {
  state = {
    ...state,
    ...nextState,
  };
  emit();
}

function getSnapshot() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHyperSyncStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getHyperSyncStoreSnapshot() {
  return getSnapshot();
}

export function invalidateSyncResponseCache() {
  syncResponseCache = null;
}

export function updateDashboardViewState(
  update:
    | Partial<DashboardViewState>
    | ((current: DashboardViewState) => Partial<DashboardViewState>)
) {
  const nextPatch =
    typeof update === "function" ? update(state.dashboardView) : update;

  setState({
    dashboardView: {
      ...state.dashboardView,
      ...nextPatch,
    },
  });
}

type DbReleasePR = {
  id: string;
  title: string;
  author: string;
  displayName: string;
  releaseBranch: string;
  mainPrId: string | null;
  patchFingerprint: string | null;
  updatedStatus: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  createdAt: string;
};

type DbMainPR = {
  id: string;
  title: string;
  author: string;
  displayName: string;
  status: string;
  patchFingerprint: string | null;
  mergedAt: string | null;
  createdAt: string;
};

type SyncApiResponse = {
  success: boolean;
  syncStatus?: { isRunning: boolean; lastSynced: string | null };
  releasePRs?: DbReleasePR[];
  mainPRs?: DbMainPR[];
  error?: string;
};

function deriveReleasePRStatus(pr: DbReleasePR, mainPRs: DbMainPR[]): ReleasePR["syncStatus"] {
  if (pr.updatedStatus === "APPROVED") return "APPROVED";
  if (!pr.mainPrId) return "MISSING";
  const mainPR = mainPRs.find((m) => m.id === pr.mainPrId);
  if (!mainPR) return "INVALID";
  if (mainPR.status === "MERGED") return "MERGED";
  if (mainPR.status === "OPEN") return "OPEN";
  if (mainPR.status === "DECLINED") return "DECLINED";
  return "INVALID";
}

function buildPrUrl(repo: string, prId: string): string {
  const base = (process.env.NEXT_PUBLIC_BITBUCKET_BASE_URL ?? "").replace(/\/+$/, "");
  const project = process.env.NEXT_PUBLIC_BITBUCKET_PROJECT_KEY ?? "";
  return `${base}/projects/${project}/repos/${repo}/pull-requests/${prId}/overview`;
}

const SYNC_REPO = "hyper-widget";

function stateFromSyncResponse(json: SyncApiResponse) {
  const dbMainPRs = json.mainPRs ?? [];
  const dbReleasePRs = json.releasePRs ?? [];

  const releasePRs: ReleasePR[] = dbReleasePRs.map((pr) => ({
    id: pr.id,
    title: pr.title,
    author: pr.author,
    releaseBranch: pr.releaseBranch,
    mainPrId: pr.mainPrId ?? null,
    patchFingerprint: pr.patchFingerprint ?? null,
    updatedStatus: pr.updatedStatus ?? null,
    syncStatus: deriveReleasePRStatus(pr, dbMainPRs),
    mergedAt: pr.mergedAt ?? null,
    updatedBy: pr.updatedBy ?? null,
    updatedAt: pr.updatedAt ?? null,
    bitbucketUrl: buildPrUrl(SYNC_REPO, pr.id),
  }));

  const mainPRs: CachedPullRequest[] = dbMainPRs.map((pr) => ({
    id: pr.id,
    title: pr.title,
    author: pr.author,
    displayName: pr.displayName,
    status: pr.status,
    targetBranch: "main",
    patchFingerprint: pr.patchFingerprint ?? null,
    mergedAt: pr.mergedAt ?? null,
    bitbucketUrl: buildPrUrl(SYNC_REPO, pr.id),
  }));

  return {
    releasePRs,
    mainPRs,
    syncStatus: {
      inProgress: json.syncStatus?.isRunning ?? false,
      processed: releasePRs.length,
      total: releasePRs.length,
      lastSyncedAt: json.syncStatus?.lastSynced ?? undefined,
    },
  };
}

export async function syncAndLoad(
  options: { quick?: boolean; force?: boolean } = {}
): Promise<boolean> {
  if (options.quick && syncResponseCache && !options.force) {
    const cachedState = stateFromSyncResponse(syncResponseCache);

    setState({
      ...cachedState,
      initialized: true,
      loading: false,
      refreshing: false,
      error: null,
    });

    return true;
  }

  if ((state.loading || state.refreshing) && !options.force) return false;

  const requestId = ++syncRequestId;

  setState({
    loading: !state.initialized,
    refreshing: state.initialized,
    error: null,
  });

  try {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quick: options.quick ?? false }),
      cache: "no-store",
    });
    const json = await parseJson<SyncApiResponse>(response);

    if (!response.ok || !json.success) {
      throw new Error(json.error ?? "Failed to sync");
    }

    if (requestId !== syncRequestId) {
      return true;
    }

    syncResponseCache = json;
    const nextState = stateFromSyncResponse(json);

    setState({
      ...nextState,
      initialized: true,
      loading: false,
      refreshing: false,
      error: null,
    });

    return true;
  } catch (error) {
    if (requestId !== syncRequestId) {
      return true;
    }

    setState({
      loading: false,
      refreshing: false,
      initialized: true,
      error: error instanceof Error ? error.message : "Failed to sync",
    });

    return true;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || `Request failed with status ${response.status}`);
  }
}
