export type ReleasePRStatus =
  | "MERGED"
  | "OPEN"
  | "DECLINED"
  | "INVALID"
  | "APPROVED"
  | "MISSING";

export type ReleasePR = {
  id: string;
  title: string;
  author: string;
  authorEmail?: string | null;
  displayName?: string;
  releaseBranch: string;
  mainPrId?: string | null;
  updatedStatus?: string | null;
  syncStatus: ReleasePRStatus;
  mergedAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  createdAt?: string;
  bitbucketUrl: string;
};

export type SyncStatus = {
  inProgress: boolean;
  syncInProgress?: boolean;
  currentStep?: string;
  processed: number;
  total: number;
  startedAt?: string;
  lastSyncedAt?: string;
  error?: string;
};
