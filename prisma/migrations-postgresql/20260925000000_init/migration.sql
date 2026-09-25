-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ReleasePR" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorEmail" TEXT,
    "displayName" TEXT NOT NULL,
    "sourceBranch" TEXT,
    "releaseBranch" TEXT NOT NULL,
    "mainPrId" TEXT,
    "patchFingerprint" TEXT,
    "updatedStatus" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3),
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleasePR_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MainPR" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceBranch" TEXT,
    "status" TEXT NOT NULL,
    "patchFingerprint" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MainPR_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "lastSynced" TIMESTAMP(3),

    CONSTRAINT "SyncStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE INDEX "ReleasePR_sourceBranch_idx" ON "ReleasePR"("sourceBranch");

-- CreateIndex
CREATE INDEX "MainPR_sourceBranch_idx" ON "MainPR"("sourceBranch");
