import type { PrismaClient } from "@prisma/client";
import { UiComponentReviewError } from "./ui-component-review";
import type { UiComponentReviewRequest } from "./ui-component-types";

export async function saveUiComponentReview(db: PrismaClient, commitSha: string, request: UiComponentReviewRequest, updatedBy: string) {
  return db.$transaction(async (tx) => {
    const state = await tx.uiComponentSyncStatus.findUnique({ where: { id: "singleton" }, select: { activeRunId: true } });
    if (state?.activeRunId !== request.runId) throw new UiComponentReviewError("Results changed after a refresh. Reload before reviewing this commit.", 409);
    const run = await tx.uiComponentRefreshRun.findUnique({ where: { id: request.runId }, select: { status: true } });
    if (run?.status !== "COMPLETED") throw new UiComponentReviewError("Only published results can be reviewed", 409);
    const member = await tx.uiComponentSnapshotCommit.findFirst({ where: { commitSha, snapshot: { runId: request.runId } }, select: { commitSha: true } });
    if (!member) throw new UiComponentReviewError("Commit is not in the published release dataset", 404);

    let changes: { mainPrId?: number | null; confirmedSourceSha?: string | null; approved?: boolean };
    if (request.action === "confirm") {
      const pr = await tx.uiComponentMainPr.findUnique({ where: { runId_prId: { runId: request.runId, prId: request.mainPrId } }, select: { toBranch: true, sourceSha: true } });
      if (!pr || pr.toBranch !== "main") throw new UiComponentReviewError("Main PR is not in the current UI Components import", 422);
      changes = { mainPrId: request.mainPrId, confirmedSourceSha: pr.sourceSha, approved: false };
    } else if (request.action === "clear-match") {
      changes = { mainPrId: null, confirmedSourceSha: null };
    } else {
      changes = { approved: request.action === "approve" };
    }
    // Patch only the requested fields so independent link/approval changes do
    // not overwrite each other. Importers never write this persistent table.
    const review = await tx.uiComponentCommitReview.upsert({
      where: { commitSha }, create: { commitSha, ...changes, updatedBy }, update: { ...changes, updatedBy },
    });
    return { mainPrId: review.mainPrId, approved: review.approved, updatedBy: review.updatedBy, updatedAt: review.updatedAt.toISOString() };
  }, { isolationLevel: "RepeatableRead" });
}
