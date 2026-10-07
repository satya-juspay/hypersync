import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../lib/ui-component-filters.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { filterUiComponentCommits, initialUiComponentListView, sameUiComponentStatuses, UI_COMPONENT_STATUSES, UI_COMPONENT_PAGE_SIZES } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const commit = (sha, authorName, matchStatus, authorTimestamp, branches, message, extra = {}) => ({
  sha: sha.repeat(40), authorName, authorEmail: `${authorName.toLowerCase()}@example.test`, matchStatus, authorTimestamp, branches, message, matches: [], review: null, ...extra,
});
const commits = [
  commit("a", "Alice", "MERGED", "2026-01-02T00:00:00Z", ["release-20260102", "release-20260103"], "Fix spacing"),
  commit("b", "Bob", "NEEDS_REVIEW", "2026-01-03T00:00:00Z", ["release-20260103"], "Align icons", { matches: [{ prId: 123, title: "Patch for mobile layout" }] }),
  commit("c", "Alice", "APPROVED", "2026-01-01T00:00:00Z", ["release-20260101"], "Typography", { review: { updatedAt: "2026-10-07T00:00:00Z", mainPrId: null } }),
  commit("d", "Dan", "UNAVAILABLE", null, ["release-20260102"], "Unavailable diff"),
];
const select = (patch = {}) => filterUiComponentCommits(commits, { ...initialUiComponentListView(), ...patch }).map((row) => row.sha[0]);

test("all statuses are selected by default with hyper-widget row sizes and newest commits first", () => {
  const initial = initialUiComponentListView();
  assert.equal(initial.statuses.length, 6);
  assert.deepEqual(initial.statuses, UI_COMPONENT_STATUSES);
  assert.deepEqual(UI_COMPONENT_PAGE_SIZES, [10, 50, 100]);
  assert.equal(initial.pageSize, 10);
  assert.deepEqual(select(), ["b", "a", "c", "d"]);
  initial.statuses.pop();
  assert.equal(initialUiComponentListView().statuses.length, 6);
});

test("multiple selected statuses form a union, and removing all shows no commits", () => {
  assert.deepEqual(select({ statuses: ["MERGED", "APPROVED"] }), ["a", "c"]);
  assert.deepEqual(select({ statuses: ["NEEDS_REVIEW"] }), ["b"]);
  assert.deepEqual(select({ statuses: [] }), []);
  assert.equal(sameUiComponentStatuses([...UI_COMPONENT_STATUSES].reverse(), UI_COMPONENT_STATUSES), true);
  assert.equal(sameUiComponentStatuses(["MERGED"], ["MERGED"]), true);
  assert.equal(sameUiComponentStatuses(["MERGED", "APPROVED"], ["MERGED"]), false);
});

test("author, shared release branch, search and status filters intersect without duplicating commits", () => {
  assert.deepEqual(select({ author: "Alice" }), ["a", "c"]);
  assert.deepEqual(select({ branch: "release-20260103" }), ["b", "a"]);
  assert.deepEqual(select({ author: "Alice", branch: "release-20260103", query: "spacing", statuses: ["MERGED"] }), ["a"]);
  assert.deepEqual(select({ author: "Bob", statuses: ["APPROVED"] }), []);
  assert.deepEqual(select({ branch: "release-20261231" }), []);
});

test("search includes main PR IDs/titles, branch, commit SHA, author email and multiline messages", () => {
  for (const query of [" #123 ", "MOBILE LAYOUT", "bob@example.test"]) assert.deepEqual(select({ query }), ["b"]);
  assert.deepEqual(select({ query: "release-20260101" }), ["c"]);
  assert.deepEqual(select({ query: "aaaaaaaa" }), ["a"]);
  assert.deepEqual(select({ query: "   " }), ["b", "a", "c", "d"]);
});

test("date ordering handles missing values last in either direction and review dates separately", () => {
  assert.deepEqual(select({ sortDirection: "asc" }), ["c", "a", "b", "d"]);
  assert.deepEqual(select({ sortBy: "reviewedAt", sortDirection: "asc" }), ["c", "a", "b", "d"]);
  assert.deepEqual(select({ sortBy: "reviewedAt", sortDirection: "desc" }), ["c", "a", "b", "d"]);
});

test("text ordering is deterministic for all sort options and never mutates the API dataset", () => {
  const before = structuredClone(commits);
  assert.deepEqual(select({ sortBy: "author", sortDirection: "asc" }), ["a", "c", "b", "d"]);
  assert.deepEqual(select({ sortBy: "author", sortDirection: "desc" }), ["d", "b", "a", "c"]);
  assert.deepEqual(select({ sortBy: "message", sortDirection: "asc" }), ["b", "a", "c", "d"]);
  assert.deepEqual(select({ sortBy: "releaseBranch", sortDirection: "asc" }), ["c", "d", "a", "b"]);
  assert.deepEqual(select({ sortBy: "matchStatus", sortDirection: "asc" }), ["d", "c", "a", "b"]);
  assert.deepEqual(commits, before);
});
