ALTER TABLE "UiComponentRefreshRun"
  ADD COLUMN "analysisVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mainPrManifest" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "analysisManifest" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mainPrCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "UiComponentMainPr" (
  "runId" TEXT NOT NULL, "prId" INTEGER NOT NULL, "title" TEXT NOT NULL,
  "state" TEXT NOT NULL, "authorName" TEXT NOT NULL,
  "fromBranch" TEXT NOT NULL, "toBranch" TEXT NOT NULL,
  "sourceSha" TEXT NOT NULL, "targetSha" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "commitShas" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "patchFingerprint" TEXT, "fingerprintStatus" TEXT NOT NULL, "fingerprintError" TEXT,
  CONSTRAINT "UiComponentMainPr_pkey" PRIMARY KEY ("runId", "prId"),
  CONSTRAINT "UiComponentMainPr_runId_fkey" FOREIGN KEY ("runId") REFERENCES "UiComponentRefreshRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "UiComponentCommitAnalysis" (
  "runId" TEXT NOT NULL, "commitSha" TEXT NOT NULL,
  "patchFingerprint" TEXT, "fingerprintStatus" TEXT NOT NULL, "fingerprintError" TEXT,
  CONSTRAINT "UiComponentCommitAnalysis_pkey" PRIMARY KEY ("runId", "commitSha"),
  CONSTRAINT "UiComponentCommitAnalysis_runId_fkey" FOREIGN KEY ("runId") REFERENCES "UiComponentRefreshRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UiComponentCommitAnalysis_commitSha_fkey" FOREIGN KEY ("commitSha") REFERENCES "UiComponentReleaseCommit"("sha") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UiComponentCommitAnalysis_commitSha_idx" ON "UiComponentCommitAnalysis"("commitSha");

CREATE TABLE "UiComponentDiffFailure" (
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UiComponentDiffFailure_pkey" PRIMARY KEY ("key")
);
