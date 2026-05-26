-- AlterTable
ALTER TABLE "ReleasePR" ADD COLUMN "authorEmail" TEXT;

-- CreateTable
CREATE TABLE "AdminUser" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT
);
