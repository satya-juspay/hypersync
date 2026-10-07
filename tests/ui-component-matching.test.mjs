import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createHash } from "node:crypto";

function compile(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const scoreUrl = compile("../lib/patch-score.ts");
const matchingUrl = compile("../lib/ui-component-matching.ts", { '"./patch-score"': JSON.stringify(scoreUrl) });
const reviewUrl = compile("../lib/ui-component-review.ts");
const { matchUiComponentCommit } = await import(matchingUrl);
const { readUiComponentDashboard } = await import(compile("../lib/ui-component-dashboard.ts", { '"./ui-component-matching"': JSON.stringify(matchingUrl), '"./ui-component-review"': JSON.stringify(reviewUrl) }));
const sha = "a".repeat(40);
const token = (prefix, value) => `${prefix}:${createHash("sha256").update(value).digest("base64url")}`;
const patch = (...tokens) => ({ patchFingerprint: ["v2", ...tokens].join("\n"), fingerprintStatus: "READY", fingerprintError: null });
const full = patch(token("F", "file"), token("A", "+added"), token("R", "-removed"));
const pr = (prId, state, commitShas = [], fingerprint = full) => ({ prId, state, commitShas, title: `PR ${prId}`, ...fingerprint });

test("exact merged membership takes priority even when diffs are unavailable", () => {
  const result = matchUiComponentCommit(sha, undefined, [pr(1, "OPEN", [sha]), pr(2, "MERGED", [sha]), pr(3, "MERGED")]);
  assert.equal(result.matchStatus, "MERGED");
  assert.deepEqual(result.matches.map((match) => [match.prId, match.state, match.reason, match.score]), [[2, "MERGED", "exact-commit", null], [1, "OPEN", "exact-commit", null]]);
});
test("open and declined exact matches retain their main PR states", () => {
  assert.equal(matchUiComponentCommit(sha, undefined, [pr(1, "OPEN", [sha])]).matchStatus, "OPEN_PR");
  assert.equal(matchUiComponentCommit(sha, undefined, [pr(1, "DECLINED", [sha])]).matchStatus, "NEEDS_REVIEW");
});
test("even a 100% patch suggestion is reviewable rather than automatically merged", () => {
  const result = matchUiComponentCommit(sha, full, [pr(1, "MERGED")]);
  assert.equal(result.matchStatus, "NEEDS_REVIEW");
  assert.equal(result.matches[0].score, 1);
  assert.deepEqual([result.matches[0].matchedFiles, result.matches[0].matchedAddedLines, result.matches[0].matchedRemovedLines], [1, 1, 1]);
});
test("removed-only patches sharing just a file never create a false suggestion", () => {
  const release = patch(token("F", "file"), token("R", "old1"));
  const candidate = patch(token("F", "file"), token("R", "old2"));
  assert.deepEqual(matchUiComponentCommit(sha, release, [pr(1, "MERGED", [], candidate)]), { matchStatus: "UNMATCHED", matches: [] });
});
test("unavailable or empty patches stay explicitly unavailable, and candidates are capped deterministically", () => {
  assert.equal(matchUiComponentCommit(sha, { fingerprintStatus: "SKIPPED_500", patchFingerprint: null }, []).matchStatus, "UNAVAILABLE");
  assert.equal(matchUiComponentCommit(sha, patch(), []).matchStatus, "UNAVAILABLE");
  const result = matchUiComponentCommit(sha, full, Array.from({ length: 9 }, (_, index) => pr(index + 1, "MERGED")));
  assert.deepEqual(result.matches.map((match) => match.prId), [9, 8, 7, 6, 5]);
  assert.equal(matchUiComponentCommit(sha, full, [pr(1, "MERGED", [], { fingerprintStatus: "SKIPPED_500", patchFingerprint: null })]).matchStatus, "UNAVAILABLE");
});
test("dashboard reads one published run, deduplicates shared commits, and never returns fingerprints", async () => {
  const calls = [];
  const commit = { sha, message: "fix", authorName: "Developer", authorEmail: "dev@example.test", authorTimestamp: new Date("2026-01-02") };
  const db = {
    uiComponentSyncStatus: { findUnique: async () => ({ activeRunId: "old", runId: "new", leaseUntil: new Date(Date.now() + 60000) }) },
    uiComponentRefreshRun: { findUnique: async ({ where }) => { calls.push(where); return { status: "COMPLETED", analysisVersion: 1, finishedAt: new Date("2026-10-01") }; } },
    uiComponentReleaseSnapshot: { findMany: async ({ where }) => { calls.push(where); return ["release-20260101", "release-20260102"].map((branch) => ({ branch, commits: [{ commit, commitSha: sha }], uiComponentsRef: sha, uiComponentsRefType: "commit", status: "release-commits", warnings: [], uiComponentsBranches: [] })); } },
    uiComponentMainPr: { findMany: async ({ where }) => { calls.push(where); return [{ ...pr(1, "MERGED", [sha]), updatedAt: new Date("2026-01-02") }]; } },
    uiComponentCommitAnalysis: { findMany: async ({ where }) => { calls.push(where); return [{ commitSha: sha, ...full }]; } },
    uiComponentCommitReview: { findMany: async ({ where }) => { assert.deepEqual(where, { commitSha: { in: [sha] } }); return []; } },
  };
  const result = await readUiComponentDashboard(db);
  assert.ok(calls.every((where) => (where.runId ?? where.id) === "old"));
  assert.equal(result.refreshing, true);
  assert.equal(result.commits.length, 1);
  assert.deepEqual(result.commits[0].branches, ["release-20260101", "release-20260102"]);
  assert.equal(result.commits[0].matchStatus, "MERGED");
  assert.equal(result.commits[0].authorEmail, "dev@example.test");
  assert.equal(result.commits[0].review, null);
  assert.equal(result.reviewsAvailable, true);
  assert.ok(!JSON.stringify(result).includes("patchFingerprint"));

  const reviewedBy = "reviewer@example.test";
  db.uiComponentCommitReview.findMany = async () => [{ commitSha: sha, approved: true, mainPrId: null, confirmedSourceSha: null, updatedBy: reviewedBy, updatedAt: new Date("2026-10-07") }];
  assert.equal((await readUiComponentDashboard(db)).commits[0].matchStatus, "APPROVED");
  // A new published snapshot containing the same SHA inherits its decision.
  db.uiComponentSyncStatus.findUnique = async () => ({ activeRunId: "next" });
  const refreshed = await readUiComponentDashboard(db);
  assert.equal(refreshed.runId, "next");
  assert.equal(refreshed.commits[0].review.updatedBy, reviewedBy);
  assert.equal(refreshed.commits[0].matchStatus, "APPROVED");

  db.uiComponentCommitReview.findMany = async () => { throw Object.assign(new Error("missing table"), { code: "P2021" }); };
  const beforeMigration = await readUiComponentDashboard(db);
  assert.equal(beforeMigration.reviewsAvailable, false);
  assert.equal(beforeMigration.commits[0].matchStatus, "MERGED");
  db.uiComponentCommitReview.findMany = async () => { throw new Error("connectivity failure"); };
  await assert.rejects(readUiComponentDashboard(db), /connectivity failure/);
});
