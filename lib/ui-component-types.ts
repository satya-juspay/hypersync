// JSON contracts shared by the isolated importer, read API and dashboard.
export type UiComponentFingerprint = {
  patchFingerprint: string | null;
  fingerprintStatus: "READY" | "SKIPPED_500" | "UNAVAILABLE";
  fingerprintError: string | null;
};

export type UiComponentMainPrInput = UiComponentFingerprint & {
  prId: number;
  title: string;
  state: "OPEN" | "MERGED" | "DECLINED";
  authorName: string;
  fromBranch: string;
  toBranch: "main";
  sourceSha: string;
  targetSha: string;
  updatedAt: string;
  commitShas: string[];
};

export type UiComponentCommitAnalysisInput = UiComponentFingerprint & { commitSha: string };
export type UiComponentMatchStatus = "MERGED" | "OPEN_PR" | "NEEDS_REVIEW" | "UNMATCHED" | "UNAVAILABLE";
export type UiComponentMatch = {
  prId: number;
  title: string;
  state: UiComponentMainPrInput["state"];
  reason: "exact-commit" | "patch-similarity";
  score: number | null;
  matchedFiles: number;
  totalFiles: number;
  matchedAddedLines: number;
  totalAddedLines: number;
  matchedRemovedLines: number;
  totalRemovedLines: number;
};

export type UiComponentDashboardCommit = {
  sha: string;
  message: string;
  authorName: string;
  authorTimestamp: string | null;
  branches: string[];
  fingerprintStatus: UiComponentFingerprint["fingerprintStatus"] | "NOT_ANALYZED";
  fingerprintError: string | null;
  matchStatus: UiComponentMatchStatus;
  matches: UiComponentMatch[];
};

export type UiComponentDashboardBranch = {
  branch: string;
  widgetHeadSha: string;
  uiComponentsRef: string;
  uiComponentsRefType: "version" | "commit" | "branch";
  uiComponentsHeadSha: string;
  uiComponentsBranches: string[];
  jenkinsBoundarySha: string | null;
  status: "published-version" | "release-commits";
  warnings: string[];
  commitShas: string[];
};

export type UiComponentDashboard = {
  success: true;
  runId: string | null;
  lastSynced: string | null;
  refreshing: boolean;
  analysisVersion: number;
  mainPrCount: number;
  mainPrFingerprintUnavailable: number;
  branches: UiComponentDashboardBranch[];
  commits: UiComponentDashboardCommit[];
};
