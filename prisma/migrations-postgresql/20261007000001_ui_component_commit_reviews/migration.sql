CREATE TABLE "UiComponentCommitReview" (
  "commitSha" TEXT NOT NULL,
  "mainPrId" INTEGER,
  "confirmedSourceSha" TEXT,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UiComponentCommitReview_pkey" PRIMARY KEY ("commitSha"),
  CONSTRAINT "UiComponentCommitReview_commitSha_fkey" FOREIGN KEY ("commitSha") REFERENCES "UiComponentReleaseCommit"("sha") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UiComponentCommitReview_mainPrId_check" CHECK ("mainPrId" IS NULL OR "mainPrId" > 0),
  CONSTRAINT "UiComponentCommitReview_confirmation_check" CHECK (("mainPrId" IS NULL) = ("confirmedSourceSha" IS NULL))
);
