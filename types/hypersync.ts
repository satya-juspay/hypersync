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
  authorEmail?: string;
  createdBy?: string;
  mergedBy?: string;
  mainPrMergedBy?: string;
  releasePrMergedBy?: string;
  releaseBranch: string;
  sourceBranch?: string;
  mainPrId?: string | null;
  patchFingerprint?: string | null;
  updatedStatus?: string | null;
  syncStatus: ReleasePRStatus;
  mergedAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  bitbucketUrl: string;
  diff?: string;
  diffError?: string;
  ignoreReason?: string | null;
  ignoreRequestedBy?: string | null;
  ignoredBy?: string | null;
  description?: string;
};

export type CachedPullRequest = {
  id: string;
  title: string;
  author: string;
  authorEmail?: string;
  sourceBranch?: string;
  targetBranch: string;
  displayName?: string;
  status?: string;
  patchFingerprint?: string | null;
  mergedAt?: string | null;
  updatedAt?: string | null;
  bitbucketUrl: string;
  diff?: string;
  diffError?: string;
  description?: string;
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
