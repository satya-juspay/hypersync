-- CreateTable
CREATE TABLE "ReleasePR" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "jiraKey" TEXT,
    "author" TEXT NOT NULL,
    "releaseBranch" TEXT NOT NULL,
    "mainPrId" TEXT,
    "syncStatus" TEXT NOT NULL,
    "description" TEXT,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mergeCommitSha" TEXT,
    "commitShas" JSONB,
    "changedFiles" JSONB
);
