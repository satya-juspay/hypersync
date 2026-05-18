-- CreateTable
CREATE TABLE "ReleasePR" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jiraKey" TEXT,
    "author" TEXT NOT NULL,
    "releaseBranch" TEXT NOT NULL,
    "mainPrId" TEXT,
    "syncStatus" TEXT NOT NULL,
    "description" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mergeCommitSha" TEXT,
    "commitShas" JSONB,
    "changedFiles" JSONB,

    CONSTRAINT "ReleasePR_pkey" PRIMARY KEY ("id")
);
