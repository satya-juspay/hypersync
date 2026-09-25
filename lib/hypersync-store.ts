"use client";

import { useSyncExternalStore } from "react";
import type { ReleasePR, ReleasePRStatus, SyncStatus } from "@/types/hypersync";

export type DashboardStatusFilter = "ALL" | ReleasePRStatus;
export type DashboardSortOption =
  | "mergedAt"
  | "updatedAt"
  | "author"
  | "releaseBranch"
  | "title";
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

type DashboardSummary = {
  total: number;
  unsynced: number;
  merged: number;
  approved: number;
};

type DashboardPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type StoreState = {
  releasePRs: ReleasePR[];
  syncStatus: SyncStatus;
  summary: DashboardSummary;
  leaderboard: Array<[string, number]>;
  branchLeaderboard: Array<[string, number]>;
  pagination: DashboardPagination;
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
const initialSummary: DashboardSummary = {
  total: 0,
  unsynced: 0,
  merged: 0,
  approved: 0,
};
const initialPagination: DashboardPagination = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
};
const initialDashboardView: DashboardViewState = {
  query: "",
  pageSize: 10,
  currentPage: 1,
  statusFilter: "ALL",
  sortBy: "mergedAt",
  sortDirection: "desc",
};

let state: StoreState = {
  releasePRs: [],
  syncStatus: initialSyncStatus,
  summary: initialSummary,
  leaderboard: [],
  branchLeaderboard: [],
  pagination: initialPagination,
  dashboardView: initialDashboardView,
  loading: false,
  refreshing: false,
  initialized: false,
  error: null,
};

const listeners = new Set<() => void>();
let requestId = 0;

function emit() {
  for (const listener of listeners) listener();
}

function setState(nextState: Partial<StoreState>) {
  state = { ...state, ...nextState };
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

type SyncApiResponse = {
  success: boolean;
  data?: ReleasePR[];
  pagination?: DashboardPagination;
  summary?: DashboardSummary;
  leaderboard?: Array<[string, number]>;
  branchLeaderboard?: Array<[string, number]>;
  syncStatus?: { isRunning: boolean; lastSynced: string | null };
  error?: string;
};

export async function syncAndLoad(
  options: { force?: boolean } = {}
): Promise<boolean> {
  if ((state.loading || state.refreshing) && !options.force) return false;

  const currentRequestId = ++requestId;
  const view = state.dashboardView;
  const params = new URLSearchParams({
    page: String(view.currentPage),
    pageSize: String(view.pageSize),
    status: view.statusFilter,
    sortBy: view.sortBy,
    sortDirection: view.sortDirection,
  });

  if (view.query.trim()) params.set("q", view.query.trim());

  setState({
    loading: !state.initialized,
    refreshing: state.initialized,
    error: null,
  });

  try {
    const response = await fetch(`/api/sync?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const json = await parseJson<SyncApiResponse>(response);

    if (!response.ok || !json.success) {
      throw new Error(json.error ?? "Failed to load PRs");
    }

    if (currentRequestId !== requestId) return true;

    const releasePRs = json.data ?? [];
    const pagination = json.pagination ?? initialPagination;

    setState({
      releasePRs,
      pagination,
      summary: json.summary ?? initialSummary,
      leaderboard: json.leaderboard ?? [],
      branchLeaderboard: json.branchLeaderboard ?? [],
      syncStatus: {
        inProgress: json.syncStatus?.isRunning ?? false,
        processed: releasePRs.length,
        total: pagination.total,
        lastSyncedAt: json.syncStatus?.lastSynced ?? undefined,
      },
      initialized: true,
      loading: false,
      refreshing: false,
      error: null,
    });

    return true;
  } catch (error) {
    if (currentRequestId !== requestId) return true;

    setState({
      loading: false,
      refreshing: false,
      initialized: true,
      error: error instanceof Error ? error.message : "Failed to load PRs",
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
