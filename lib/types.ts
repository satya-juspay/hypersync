export interface ReleasePR {
  id: string;
  title: string;
  author: string;
  releaseBranch: string;
  mainPrId: string | null;
  syncStatus: string;
  createdAt: string;
  mergedAt: string | null;
  updatedAt: string;
}

export interface ReleasePRDetail extends ReleasePR {
  jiraKey: string | null;
  description: string | null;
  mergeCommitSha: string | null;
  commitShas: string[] | null;
  changedFiles: string[] | null;
}
