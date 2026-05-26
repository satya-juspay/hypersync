/*
  Warnings:

  - You are about to drop the column `changedFiles` on the `ReleasePR` table. All the data in the column will be lost.
  - You are about to drop the column `commitShas` on the `ReleasePR` table. All the data in the column will be lost.
  - You are about to drop the column `jiraKey` on the `ReleasePR` table. All the data in the column will be lost.
  - You are about to drop the column `mergeCommitSha` on the `ReleasePR` table. All the data in the column will be lost.
  - Added the required column `displayName` to the `ReleasePR` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "MainPR" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "releasePRs" JSONB,
    "description" TEXT,
    "diff" JSONB,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncStatus" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "lastSynced" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReleasePR" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "releaseBranch" TEXT NOT NULL,
    "mainPrId" TEXT,
    "syncStatus" TEXT NOT NULL,
    "description" TEXT,
    "diff" JSONB,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ReleasePR" ("author", "createdAt", "description", "id", "mainPrId", "mergedAt", "releaseBranch", "syncStatus", "title", "updatedAt") SELECT "author", "createdAt", "description", "id", "mainPrId", "mergedAt", "releaseBranch", "syncStatus", "title", "updatedAt" FROM "ReleasePR";
DROP TABLE "ReleasePR";
ALTER TABLE "new_ReleasePR" RENAME TO "ReleasePR";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
