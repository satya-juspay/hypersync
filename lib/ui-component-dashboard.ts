import type { PrismaClient } from "@prisma/client";
import { matchUiComponentCommit } from "./ui-component-matching";
import { applyUiComponentReview } from "./ui-component-review";
import type { UiComponentDashboard, UiComponentMainPrInput, UiComponentFingerprint } from "./ui-component-types";

export async function readUiComponentDashboard(db: PrismaClient): Promise<UiComponentDashboard> {
  const state = await db.uiComponentSyncStatus.findUnique({ where: { id: "singleton" } });
  const refreshing = !!(state?.runId && state.leaseUntil && state.leaseUntil > new Date());
  const empty: UiComponentDashboard = { success: true, runId: null, lastSynced: null, refreshing, analysisVersion: 0,
    mainPrCount: 0, mainPrFingerprintUnavailable: 0, reviewsAvailable: true, branches: [], commits: [] };
  if (!state?.activeRunId) return empty;
  // Capture the pointer once. Completed runs are immutable, so a concurrent
  // publication cannot mix release snapshots with another run's PRs.
  const runId = state.activeRunId;
  const [run, snapshots, prs, analyses] = await Promise.all([
    db.uiComponentRefreshRun.findUnique({ where: { id: runId } }),
    db.uiComponentReleaseSnapshot.findMany({ where: { runId }, include: { commits: { include: { commit: true } } }, orderBy: { branch: "desc" } }),
    db.uiComponentMainPr.findMany({ where: { runId } }),
    db.uiComponentCommitAnalysis.findMany({ where: { runId } }),
  ]);
  if (!run || run.status !== "COMPLETED") throw new Error("Invalid published UI Components run");
  const commitShas = [...new Set(snapshots.flatMap((snapshot) => snapshot.commits.map((link) => link.commitSha)))];
  let reviewsAvailable = true;
  const reviews = await db.uiComponentCommitReview.findMany({ where: { commitSha: { in: commitShas } } }).catch((error: unknown) => {
    // Keep the existing read-only dashboard available during an additive
    // migration rollout; disable review controls until their table is ready.
    const code = (error as { code?: string }).code;
    if (code !== "P2021" && code !== "P2022") throw error;
    reviewsAvailable = false;
    return [];
  });
  const reviewBySha = new Map(reviews.map((review) => [review.commitSha, review]));
  const mainPrs = prs.map((pr) => ({ ...pr, updatedAt: pr.updatedAt.toISOString() })) as UiComponentMainPrInput[];
  const analysisBySha = new Map(analyses.map((row) => [row.commitSha, row as UiComponentFingerprint]));
  const commits = new Map<string, UiComponentDashboard["commits"][number]>();
  const branches = snapshots.map((snapshot) => {
    for (const { commit } of snapshot.commits) {
      let view = commits.get(commit.sha);
      if (!view) {
        const analysis = analysisBySha.get(commit.sha);
        view = { sha: commit.sha, message: commit.message, authorName: commit.authorEmail || commit.authorName || "Unknown author",
          authorEmail: commit.authorEmail,
          authorTimestamp: commit.authorTimestamp?.toISOString() ?? null, branches: [],
          fingerprintStatus: analysis?.fingerprintStatus ?? "NOT_ANALYZED", fingerprintError: analysis?.fingerprintError ?? null,
          ...applyUiComponentReview(matchUiComponentCommit(commit.sha, analysis, mainPrs), reviewBySha.get(commit.sha), mainPrs) };
        commits.set(commit.sha, view);
      }
      view.branches.push(snapshot.branch);
    }
    return { branch: snapshot.branch, widgetHeadSha: snapshot.widgetHeadSha, uiComponentsRef: snapshot.uiComponentsRef,
      uiComponentsRefType: snapshot.uiComponentsRefType as "version" | "commit" | "branch", uiComponentsHeadSha: snapshot.uiComponentsHeadSha,
      uiComponentsBranches: snapshot.uiComponentsBranches, jenkinsBoundarySha: snapshot.jenkinsBoundarySha,
      status: snapshot.status as "published-version" | "release-commits", warnings: snapshot.warnings,
      commitShas: snapshot.commits.map((link) => link.commitSha).sort() };
  });
  return { ...empty, runId, lastSynced: run.finishedAt?.toISOString() ?? null, analysisVersion: run.analysisVersion, reviewsAvailable,
    mainPrCount: prs.length, mainPrFingerprintUnavailable: prs.filter((pr) => pr.fingerprintStatus !== "READY").length,
    branches, commits: [...commits.values()].sort((a, b) => (b.authorTimestamp ?? "").localeCompare(a.authorTimestamp ?? "") || a.sha.localeCompare(b.sha)) };
}
