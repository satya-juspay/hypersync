import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../lib/ui-component-summary.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { summarizeUiComponentCommits, UI_COMPONENT_UNSYNCED_STATUSES } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const commit = (sha, authorName, matchStatus, branches = ["release-20261001"]) => ({ sha, authorName, matchStatus, branches });

test("four summary totals partition unique commits and unsynced excludes merged and approved", () => {
  const commits = [
    commit("a", "Alice", "MERGED"), commit("b", "Bob", "APPROVED"),
    ...UI_COMPONENT_UNSYNCED_STATUSES.map((status, index) => commit(String(index), "Carol", status)),
  ];
  const summary = summarizeUiComponentCommits(commits);
  assert.deepEqual(UI_COMPONENT_UNSYNCED_STATUSES, ["OPEN_PR", "NEEDS_REVIEW", "UNMATCHED", "UNAVAILABLE"]);
  assert.equal(summary.total, 6);
  assert.equal(summary.merged, 1);
  assert.equal(summary.approved, 1);
  assert.equal(summary.unsynced, 4);
  assert.equal(summary.total, summary.merged + summary.approved + summary.unsynced);
  assert.deepEqual(summary.contributors, [["Carol", 4]]);
});

test("shared commits count once overall and once per affected branch, not once per branch occurrence", () => {
  const shared = commit("a", "Alice", "NEEDS_REVIEW", ["release-20261001", "release-20261002", "release-20261001"]);
  const summary = summarizeUiComponentCommits([shared, shared, commit("b", "Bob", "OPEN_PR", ["release-20261002"])]);
  assert.equal(summary.total, 2);
  assert.equal(summary.unsynced, 2);
  assert.deepEqual(summary.contributors, [["Alice", 1], ["Bob", 1]]);
  assert.deepEqual(summary.branches, [["release-20261002", 2], ["release-20261001", 1]]);
});

test("both risk leaderboards rank descending, break ties by name and include only the top five", () => {
  const commits = Array.from({ length: 7 }, (_, i) => commit(String(i), `Author ${i}`, "UNMATCHED", [`release-2026100${i}`]));
  commits.push(commit("high", "Author 6", "NEEDS_REVIEW", ["release-20261006"]));
  const summary = summarizeUiComponentCommits(commits);
  assert.equal(summary.contributors.length, 5);
  assert.equal(summary.branches.length, 5);
  assert.deepEqual(summary.contributors, [["Author 6", 2], ["Author 0", 1], ["Author 1", 1], ["Author 2", 1], ["Author 3", 1]]);
  assert.deepEqual(summary.branches[0], ["release-20261006", 2]);
  assert.deepEqual(summary.branches[1], ["release-20261000", 1]);
});

test("a merged patch suggestion remains unsynced until the commit's match is confirmed", () => {
  const suggested = { ...commit("a", "Alice", "NEEDS_REVIEW"), matches: [{ state: "MERGED", reason: "patch-similarity", score: 1 }] };
  assert.equal(summarizeUiComponentCommits([suggested]).unsynced, 1);
  assert.equal(summarizeUiComponentCommits([{ ...suggested, matchStatus: "MERGED" }]).merged, 1);
});

test("empty and fully synced datasets have no risk entries and input data is not mutated", () => {
  assert.deepEqual(summarizeUiComponentCommits([]), { total: 0, unsynced: 0, merged: 0, approved: 0, contributors: [], branches: [] });
  const commits = [commit("a", "Alice", "MERGED"), commit("b", "Bob", "APPROVED")];
  const before = structuredClone(commits);
  assert.deepEqual(summarizeUiComponentCommits(commits).contributors, []);
  assert.deepEqual(summarizeUiComponentCommits(commits).branches, []);
  assert.deepEqual(commits, before);
});
