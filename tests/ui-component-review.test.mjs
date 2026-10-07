import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const reviewUrl = compile("../lib/ui-component-review.ts");
const { applyUiComponentReview, canReviewUiComponentCommit, parseUiComponentReviewRequest, UiComponentReviewError } = await import(reviewUrl);
const storeUrl = compile("../lib/ui-component-review-store.ts", { '"./ui-component-review"': JSON.stringify(reviewUrl) });
const sha = "a".repeat(40);
const sourceSha = "b".repeat(40);
const automatic = { matchStatus: "NEEDS_REVIEW", matches: [{ prId: 12, title: "Fix", state: "MERGED", reason: "patch-similarity", score: 1, matchedFiles: 1, totalFiles: 1, matchedAddedLines: 2, totalAddedLines: 2, matchedRemovedLines: 0, totalRemovedLines: 0 }] };
const stored = (overrides = {}) => ({ mainPrId: 12, confirmedSourceSha: sourceSha, approved: false, updatedBy: "admin@example.test", updatedAt: new Date("2026-10-07"), ...overrides });
const mainPr = (overrides = {}) => ({ prId: 12, title: "Fix", state: "MERGED", sourceSha, toBranch: "main", ...overrides });

test("review input rejects malformed objects, actions, IDs and mass-assignment fields", () => {
  for (const body of [null, [], 1, {}, { runId: "", action: "approve" }, { runId: "run", action: "merge" },
    { runId: "run", action: ["approve"] }, { runId: "run", action: "approve", updatedBy: "attacker" }, { runId: "run", action: "approve", mainPrId: 12 }]) {
    assert.throws(() => parseUiComponentReviewRequest(body), UiComponentReviewError);
  }
  for (const mainPrId of [undefined, null, "12", 0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => parseUiComponentReviewRequest({ runId: "run", action: "confirm", mainPrId }), UiComponentReviewError);
  }
  for (const action of ["approve", "unapprove", "clear-match"]) assert.deepEqual(parseUiComponentReviewRequest({ runId: "run", action }), { runId: "run", action });
  assert.deepEqual(parseUiComponentReviewRequest({ runId: "run", action: "confirm", mainPrId: 12 }), { runId: "run", action: "confirm", mainPrId: 12 });
});

test("review visibility requires authentication and a real author email or admin access", () => {
  const author = { email: " DEV@example.test ", isAuthenticated: true, canEditAnyPR: false };
  assert.equal(canReviewUiComponentCommit(author, "dev@example.test"), true);
  assert.equal(canReviewUiComponentCommit(author, null), false);
  assert.equal(canReviewUiComponentCommit(author, "other@example.test"), false);
  assert.equal(canReviewUiComponentCommit({ ...author, canEditAnyPR: true }, null), true);
  assert.equal(canReviewUiComponentCommit({ ...author, isAuthenticated: false, canEditAnyPR: true }, "dev@example.test"), false);
  assert.equal(canReviewUiComponentCommit(null, "dev@example.test"), false);
});

test("confirmation resolves suggestions using actual main PR states and retains score evidence", () => {
  for (const [state, status] of [["MERGED", "MERGED"], ["OPEN", "OPEN_PR"], ["DECLINED", "NEEDS_REVIEW"]]) {
    const result = applyUiComponentReview(automatic, stored(), [mainPr({ state })]);
    assert.equal(result.matchStatus, status);
    assert.equal(result.matches[0].reason, "manual-confirmation");
    assert.equal(result.matches[0].score, 1);
    assert.equal(result.matches[0].matchedAddedLines, 2);
    assert.equal(result.matches.length, 1);
    assert.equal(result.review.updatedAt, "2026-10-07T00:00:00.000Z");
  }
  const manual = applyUiComponentReview({ matchStatus: "UNMATCHED", matches: [] }, stored(), [mainPr()]);
  assert.equal(manual.matchStatus, "MERGED");
  assert.equal(manual.matches[0].score, null);
});

test("missing and changed confirmed PRs cannot silently remain marked merged", () => {
  const missing = applyUiComponentReview(automatic, stored(), []);
  assert.equal(missing.matchStatus, "NEEDS_REVIEW");
  assert.match(missing.reviewWarning, /not in the latest imported dataset/);
  const changed = applyUiComponentReview(automatic, stored(), [mainPr({ sourceSha: "c".repeat(40) })]);
  assert.equal(changed.matchStatus, "NEEDS_REVIEW");
  assert.match(changed.reviewWarning, /changed since confirmation/);
  assert.equal(changed.matches[0].reason, "patch-similarity");
});

test("manual approval is distinct from merging and removing overrides restores automatic analysis", () => {
  assert.equal(applyUiComponentReview(automatic, stored({ approved: true }), []).matchStatus, "APPROVED");
  const cleared = applyUiComponentReview(automatic, stored({ mainPrId: null, confirmedSourceSha: null }), []);
  assert.equal(cleared.matchStatus, "NEEDS_REVIEW");
  assert.equal(cleared.reviewWarning, null);
  assert.deepEqual(cleared.matches, automatic.matches);
  const unreviewed = applyUiComponentReview(automatic, undefined, []);
  assert.equal(unreviewed.review, null);
  assert.equal(unreviewed.matchStatus, "NEEDS_REVIEW");
});

const context = {};
globalThis.__uiReviewRouteContext = context;
const { PATCH } = await import(compile("../app/api/ui-components/commits/[sha]/review/route.ts", {
  'import { NextResponse } from "next/server";': 'const NextResponse = { json: (body, init) => Response.json(body, init) };',
  'import { canEditReleasePR, getCurrentUserEmail } from "@/lib/authz";': 'const context = globalThis.__uiReviewRouteContext; const getCurrentUserEmail = async () => context.userEmail; const canEditReleasePR = async (email, authorEmail) => { context.authorEmailChecked = authorEmail; return context.admin || (!!authorEmail && email === authorEmail); };',
  'import { prisma } from "@/lib/prisma";': 'const prisma = new Proxy({}, { get: (_, key) => context.db[key] });',
  '"@/lib/ui-component-review"': JSON.stringify(reviewUrl),
  '"@/lib/ui-component-review-store"': JSON.stringify(storeUrl),
}));
delete globalThis.__uiReviewRouteContext;

function reset() {
  Object.assign(context, { userEmail: "dev@example.test", authorEmail: "dev@example.test", admin: false,
    activeRunId: "run", completed: true, exists: true, member: true, pr: mainPr(), review: null, writes: [], error: null });
  const db = {
    uiComponentReleaseCommit: { findUnique: async () => context.exists ? { authorEmail: context.authorEmail } : null },
    uiComponentSyncStatus: { findUnique: async () => ({ activeRunId: context.activeRunId }) },
    uiComponentRefreshRun: { findUnique: async () => ({ status: context.completed ? "COMPLETED" : "RUNNING" }) },
    uiComponentSnapshotCommit: { findFirst: async ({ where }) => { assert.equal(where.snapshot.runId, "run"); assert.equal(where.commitSha, sha); return context.member ? { commitSha: sha } : null; } },
    uiComponentMainPr: { findUnique: async ({ where }) => { assert.deepEqual(where.runId_prId, { runId: "run", prId: 12 }); return context.pr; } },
    uiComponentCommitReview: { upsert: async ({ where, create, update }) => {
      if (context.error) throw context.error;
      assert.deepEqual(where, { commitSha: sha });
      context.writes.push({ create, update });
      context.review = { mainPrId: null, confirmedSourceSha: null, approved: false, ...(context.review ? { ...context.review, ...update } : create), updatedAt: new Date("2026-10-07") };
      return context.review;
    } },
  };
  db.$transaction = async (fn, options) => { assert.equal(options.isolationLevel, "RepeatableRead"); return fn(db); };
  context.db = db;
}
async function request(body = { runId: "run", action: "approve" }, pathSha = sha, headers = {}) {
  return PATCH(new Request("https://hypersync.example.test/api/ui-components/commits/sha/review", {
    method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ sha: pathSha }) });
}

test("review endpoint denies guests, unrelated users and missing-author impersonation without writes", async () => {
  reset(); context.userEmail = null;
  assert.equal((await request()).status, 401);
  reset(); context.userEmail = "other@example.test";
  assert.equal((await request()).status, 403);
  reset(); context.authorEmail = null;
  assert.equal((await request()).status, 403);
  assert.equal(context.authorEmailChecked, null);
  assert.equal(context.writes.length, 0);
  context.admin = true;
  assert.equal((await request()).status, 200);
});

test("review endpoint bounds request bodies and validates SHA and JSON", async () => {
  reset();
  for (const [body, pathSha, expected] of [["invalid", sha, 400], ["{}", "abc", 400], ["null", sha, 400], ["x".repeat(4097), sha, 413]]) {
    assert.equal((await request(body, pathSha)).status, expected);
  }
  assert.equal((await request({}, sha, { "content-length": "4097" })).status, 413);
  assert.equal((await request({}, sha, { "Content-Type": "text/plain" })).status, 415);
  assert.equal(context.writes.length, 0);
});

test("review endpoint only accepts commits and main PRs in a completed currently published run", async () => {
  for (const [field, value, status] of [["exists", false, 404], ["activeRunId", "new", 409], ["completed", false, 409], ["member", false, 404], ["pr", null, 422], ["pr", mainPr({ toBranch: "release" }), 422]]) {
    reset(); context[field] = value;
    assert.equal((await request({ runId: "run", action: "confirm", mainPrId: 12 })).status, status, field);
    assert.equal(context.writes.length, 0);
  }
});

test("author can confirm, approve, unapprove and clear only the intended persistent review fields", async () => {
  reset();
  const confirmed = await request({ runId: "run", action: "confirm", mainPrId: 12 }, sha.toUpperCase());
  assert.equal(confirmed.status, 200);
  assert.deepEqual(context.writes[0].update, { mainPrId: 12, confirmedSourceSha: sourceSha, approved: false, updatedBy: "dev@example.test" });
  assert.equal((await confirmed.json()).review.updatedBy, "dev@example.test");
  await request({ runId: "run", action: "approve" });
  assert.equal(context.review.approved, true);
  assert.equal(context.review.mainPrId, 12);
  await request({ runId: "run", action: "unapprove" });
  assert.equal(context.review.approved, false);
  assert.equal(context.review.mainPrId, 12);
  await request({ runId: "run", action: "approve" });
  await request({ runId: "run", action: "clear-match" });
  assert.equal(context.review.mainPrId, null);
  assert.equal(context.review.confirmedSourceSha, null);
  assert.equal(context.review.approved, true);
  await request({ runId: "run", action: "confirm", mainPrId: 12 });
  assert.equal(context.review.approved, false);
});

test("review failures distinguish pending migrations and concurrent updates without exposing database details", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    for (const [code, status] of [["P2021", 503], ["P2022", 503], ["P2034", 409], ["P1001", 500]]) {
      reset(); context.error = Object.assign(new Error("secret database detail"), { code });
      const response = await request();
      assert.equal(response.status, status);
      assert.ok(!(await response.text()).includes("secret database detail"));
    }
  } finally { console.error = log; }
});
