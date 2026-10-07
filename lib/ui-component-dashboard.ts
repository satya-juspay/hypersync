import type { PrismaClient } from "@prisma/client";
import { matchUiComponentCommit } from "./ui-component-matching";
import type { UiComponentDashboard, UiComponentMainPrInput, UiComponentFingerprint } from "./ui-component-types";

export async function readUiComponentDashboard(db: PrismaClient): Promise<UiComponentDashboard> {
  const state = await db.uiComponentSyncStatus.findUnique({ where: { id: "singleton" } });
  const refreshing = !!(state?.runId && state.leaseUntil && state.leaseUntil > new Date());
  const empty: UiComponentDashboard = { success: true, runId: null, lastSynced: null, refreshing, analysisVersion: 0,
    mainPrCount: 0, mainPrFingerprintUnavailable: 0, branches: [], commits: [] };
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
  const mainPrs = prs.map((pr) => ({ ...pr, updatedAt: pr.updatedAt.toISOString() })) as UiComponentMainPrInput[];
  const analysisBySha = new Map(analyses.map((row) => [row.commitSha, row as UiComponentFingerprint]));
  const commits = new Map<string, UiComponentDashboard["commits"][number]>();
  const branches = snapshots.map((snapshot) => {
    for (const { commit } of snapshot.commits) {
      let view = commits.get(commit.sha);
      if (!view) {
        const analysis = analysisBySha.get(commit.sha);
        view = { sha: commit.sha, message: commit.message, authorName: commit.authorEmail || commit.authorName || "Unknown author",
          authorTimestamp: commit.authorTimestamp?.toISOString() ?? null, branches: [],
          fingerprintStatus: analysis?.fingerprintStatus ?? "NOT_ANALYZED", fingerprintError: analysis?.fingerprintError ?? null,
          ...matchUiComponentCommit(commit.sha, analysis, mainPrs) };
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
  return { ...empty, runId, lastSynced: run.finishedAt?.toISOString() ?? null, analysisVersion: run.analysisVersion,
    mainPrCount: prs.length, mainPrFingerprintUnavailable: prs.filter((pr) => pr.fingerprintStatus !== "READY").length,
    branches, commits: [...commits.values()].sort((a, b) => (b.authorTimestamp ?? "").localeCompare(a.authorTimestamp ?? "") || a.sha.localeCompare(b.sha)) };
}
