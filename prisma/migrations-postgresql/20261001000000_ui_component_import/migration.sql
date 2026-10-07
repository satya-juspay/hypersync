-- Additive only: do not alter or populate any existing hyper-widget tables.
CREATE TABLE "UiComponentRefreshRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "branchManifest" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "branchCount" INTEGER NOT NULL DEFAULT 0,
    "commitCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UiComponentRefreshRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UiComponentSyncStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "runId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastSynced" TIMESTAMP(3),
    "activeRunId" TEXT,
    CONSTRAINT "UiComponentSyncStatus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UiComponentReleaseSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "widgetHeadSha" TEXT NOT NULL,
    "uiComponentsRef" TEXT NOT NULL,
    "uiComponentsRefType" TEXT NOT NULL,
    "uiComponentsHeadSha" TEXT NOT NULL,
    "uiComponentsBranches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jenkinsBoundarySha" TEXT,
    "status" TEXT NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedCommitCount" INTEGER NOT NULL,
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UiComponentReleaseSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UiComponentReleaseCommit" (
    "sha" TEXT NOT NULL,
    "displayId" TEXT NOT NULL,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "authorTimestamp" TIMESTAMP(3),
    "message" TEXT NOT NULL,
    "parents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UiComponentReleaseCommit_pkey" PRIMARY KEY ("sha")
);

CREATE TABLE "UiComponentSnapshotCommit" (
    "snapshotId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    CONSTRAINT "UiComponentSnapshotCommit_pkey" PRIMARY KEY ("snapshotId", "commitSha")
);

CREATE INDEX "UiComponentRefreshRun_status_startedAt_idx" ON "UiComponentRefreshRun"("status", "startedAt");
CREATE UNIQUE INDEX "UiComponentSyncStatus_activeRunId_key" ON "UiComponentSyncStatus"("activeRunId");
CREATE UNIQUE INDEX "UiComponentReleaseSnapshot_runId_branch_key" ON "UiComponentReleaseSnapshot"("runId", "branch");
CREATE INDEX "UiComponentReleaseSnapshot_branch_createdAt_idx" ON "UiComponentReleaseSnapshot"("branch", "createdAt");
CREATE INDEX "UiComponentReleaseSnapshot_uiComponentsHeadSha_idx" ON "UiComponentReleaseSnapshot"("uiComponentsHeadSha");
CREATE INDEX "UiComponentSnapshotCommit_commitSha_idx" ON "UiComponentSnapshotCommit"("commitSha");

ALTER TABLE "UiComponentSyncStatus" ADD CONSTRAINT "UiComponentSyncStatus_activeRunId_fkey" FOREIGN KEY ("activeRunId") REFERENCES "UiComponentRefreshRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UiComponentReleaseSnapshot" ADD CONSTRAINT "UiComponentReleaseSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "UiComponentRefreshRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UiComponentSnapshotCommit" ADD CONSTRAINT "UiComponentSnapshotCommit_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "UiComponentReleaseSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UiComponentSnapshotCommit" ADD CONSTRAINT "UiComponentSnapshotCommit_commitSha_fkey" FOREIGN KEY ("commitSha") REFERENCES "UiComponentReleaseCommit"("sha") ON DELETE RESTRICT ON UPDATE CASCADE;
