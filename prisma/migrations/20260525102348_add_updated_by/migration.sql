/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `MainPR` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `ReleasePR` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MainPR" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_MainPR" ("author", "createdAt", "displayName", "id", "mergedAt", "status", "title") SELECT "author", "createdAt", "displayName", "id", "mergedAt", "status", "title" FROM "MainPR";
DROP TABLE "MainPR";
ALTER TABLE "new_MainPR" RENAME TO "MainPR";
CREATE TABLE "new_ReleasePR" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "releaseBranch" TEXT NOT NULL,
    "mainPrId" TEXT,
    "updatedStatus" TEXT,
    "updatedBy" TEXT,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ReleasePR" ("author", "createdAt", "displayName", "id", "mainPrId", "mergedAt", "releaseBranch", "title", "updatedStatus") SELECT "author", "createdAt", "displayName", "id", "mainPrId", "mergedAt", "releaseBranch", "title", "updatedStatus" FROM "ReleasePR";
DROP TABLE "ReleasePR";
ALTER TABLE "new_ReleasePR" RENAME TO "ReleasePR";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
