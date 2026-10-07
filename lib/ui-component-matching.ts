import { findPatchMatchesFromFingerprints } from "./patch-score";
import type { UiComponentFingerprint, UiComponentMainPrInput, UiComponentMatch, UiComponentMatchStatus } from "./ui-component-types";

const priority = { MERGED: 0, OPEN: 1, DECLINED: 2 };
export function matchUiComponentCommit(
  sha: string,
  analysis: UiComponentFingerprint | undefined,
  mainPrs: UiComponentMainPrInput[],
): { matchStatus: UiComponentMatchStatus; matches: UiComponentMatch[] } {
  const exact = mainPrs.filter((pr) => pr.commitShas.includes(sha))
    .sort((a, b) => priority[a.state] - priority[b.state] || b.prId - a.prId);
  if (exact.length) {
    return {
      matchStatus: exact.some((pr) => pr.state === "MERGED") ? "MERGED" : exact.some((pr) => pr.state === "OPEN") ? "OPEN_PR" : "NEEDS_REVIEW",
      matches: exact.map((pr) => ({ prId: pr.prId, title: pr.title, state: pr.state, reason: "exact-commit", score: null,
        matchedFiles: 0, totalFiles: 0, matchedAddedLines: 0, totalAddedLines: 0, matchedRemovedLines: 0, totalRemovedLines: 0 })),
    };
  }
  if (analysis?.fingerprintStatus !== "READY" || !analysis.patchFingerprint || !/^[AR]:/m.test(analysis.patchFingerprint)) {
    return { matchStatus: "UNAVAILABLE", matches: [] };
  }
  const byId = new Map(mainPrs.map((pr) => [String(pr.prId), pr]));
  const matches = findPatchMatchesFromFingerprints(analysis.patchFingerprint,
    mainPrs.filter((pr) => pr.fingerprintStatus === "READY").map((pr) => ({ mainPrId: String(pr.prId), patchFingerprint: pr.patchFingerprint })))
    // The legacy score treats an absent category as 100% overlap. Require an
    // actual common changed line to avoid same-file-only suggestions.
    .filter((score) => score.matchedAddedLines + score.matchedRemovedLines > 0)
    .map((score): UiComponentMatch => {
      const pr = byId.get(score.mainPrId)!;
      return { prId: pr.prId, title: pr.title, state: pr.state, reason: "patch-similarity", score: score.score,
        matchedFiles: score.matchedFiles, totalFiles: score.totalFiles,
        matchedAddedLines: score.matchedAddedLines, totalAddedLines: score.totalAddedLines,
        matchedRemovedLines: score.matchedRemovedLines, totalRemovedLines: score.totalRemovedLines };
    }).sort((a, b) => (b.score! - a.score!) || priority[a.state] - priority[b.state] || b.prId - a.prId).slice(0, 5);
  return { matchStatus: matches.length ? "NEEDS_REVIEW" : mainPrs.some((pr) => pr.fingerprintStatus !== "READY") ? "UNAVAILABLE" : "UNMATCHED", matches };
}
