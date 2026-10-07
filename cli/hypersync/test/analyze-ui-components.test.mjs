import assert from "node:assert/strict";
import test from "node:test";
import { analyzeUiComponents, fingerprintUiComponentDiff } from "../src/analyze-ui-components.mjs";

const sha = (value) => value.repeat(40);
const commit = { sha: sha("a"), parents: [sha("b")] };
const config = { bitbucketUrl: "https://bitbucket.example.test", project: "PICAF", token: "secret" };
const diff = (overrides = {}) => ({ diffs: [{ source: { toString: "src/file" }, destination: { toString: "src/file" }, hunks: [{ segments: [{ type: "ADDED", lines: [{ line: "const a = 1;" }] }, { type: "REMOVED", lines: [{ line: "const a = 2;" }] }] }] }], ...overrides });
const pr = (id, state = "MERGED", overrides = {}) => ({ id, version: 1, title: `PR ${id}`, state, updatedDate: Date.parse("2026-01-02"), author: { user: { name: "dev" } }, fromRef: { displayId: "feature", latestCommit: sha("c") }, toRef: { id: "refs/heads/main", latestCommit: sha("d") }, ...overrides });
const page = (values, last = true, nextPageStart = 0) => ({ values, isLastPage: last, nextPageStart });

function harness({ failDiff = false, mutate = false, paged = false } = {}) {
  const requests = [];
  const failures = new Set();
  let details = 0;
  return {
    requests, failures,
    options: { commits: [commit], delayMs: 0, onProgress: () => {},
      send: async ({ action, keys, key }) => {
        if (action === "diff-failures") return { keys: keys.filter((key) => failures.has(key)) };
        assert.equal(action, "diff-failed"); failures.add(key); return {};
      },
      fetchImpl: async (url, { headers }) => {
        assert.equal(headers.Authorization, "Bearer secret");
        const u = new URL(url);
        requests.push(u);
        assert.ok(u.pathname.includes("/repos/ui-components/"));
        if (u.pathname.endsWith("/pull-requests")) {
          assert.equal(u.searchParams.get("state"), "ALL"); assert.equal(u.searchParams.get("at"), "refs/heads/main");
          if (paged && u.searchParams.get("start") === "0") return Response.json(page([pr(1)], false, 17));
          return Response.json(page(paged ? [pr(2, "OPEN")] : [pr(1), pr(2, "OPEN"), pr(3, "DECLINED"), pr(4, "OPEN", { updatedDate: Date.parse("2025-01-01") }), pr(5, "OPEN", { toRef: { id: "refs/heads/release" } })]));
        }
        if (/pull-requests\/\d+$/.test(u.pathname)) { details++; const id = Number(u.pathname.split("/").at(-1)); return Response.json(pr(id, id === 1 ? "MERGED" : id === 2 ? "OPEN" : "DECLINED", { version: mutate ? details : 1 })); }
        if (/pull-requests\/\d+\/commits$/.test(u.pathname)) return Response.json(page([{ id: commit.sha }]));
        if (u.pathname.endsWith("/diff")) {
          if (u.pathname.includes("/commits/")) assert.equal(u.searchParams.get("since"), commit.parents[0]);
          return failDiff ? new Response("internal details", { status: 500 }) : Response.json(diff());
        }
        assert.fail(`Unexpected URL ${url}`);
      },
    },
  };
}
test("main PR discovery is paged, repo-scoped and excludes pre-2026 or non-main PRs", async () => {
  const h = harness();
  const result = await analyzeUiComponents(config, h.options);
  assert.deepEqual(result.mainPrs.map((pr) => pr.prId), [1, 2, 3]);
  assert.deepEqual(result.mainPrs.map((pr) => pr.state), ["MERGED", "OPEN", "DECLINED"]);
  assert.ok(result.mainPrs.every((pr) => pr.commitShas[0] === commit.sha));
  assert.equal(result.analyses.length, 1);
  const p = harness({ paged: true });
  assert.equal((await analyzeUiComponents(config, p.options)).mainPrs.length, 2);
  assert.ok(p.requests.some((url) => url.searchParams.get("start") === "17"));
});
test("HTTP 500 diffs are persisted immediately and skipped on the next run", async () => {
  const h = harness({ failDiff: true });
  const first = await analyzeUiComponents(config, h.options);
  assert.ok(first.mainPrs.every((pr) => pr.fingerprintStatus === "SKIPPED_500"));
  assert.equal(first.analyses[0].fingerprintStatus, "SKIPPED_500");
  assert.equal(h.failures.size, 4);
  const before = h.requests.filter((url) => url.pathname.endsWith("/diff")).length;
  await analyzeUiComponents(config, h.options);
  assert.equal(h.requests.filter((url) => url.pathname.endsWith("/diff")).length, before);
});
test("a PR that changes during commit/diff reads aborts the analysis", async () => {
  const h = harness({ mutate: true });
  await assert.rejects(analyzeUiComponents(config, h.options), /changed while reading/);
});
test("truncation at every diff level is rejected and deleted-file paths are preserved", () => {
  assert.throws(() => fingerprintUiComponentDiff(diff({ truncated: true })), /truncated/);
  for (const level of ["diff", "hunk", "segment", "line"]) {
    const value = diff();
    const file = value.diffs[0], hunk = file.hunks[0], segment = hunk.segments[0];
    ({ diff: file, hunk, segment, line: segment.lines[0] })[level].truncated = true;
    assert.throws(() => fingerprintUiComponentDiff(value), /truncated/);
  }
  const removed = diff(); removed.diffs[0].destination = null;
  assert.equal(fingerprintUiComponentDiff(removed), fingerprintUiComponentDiff(diff()));
  assert.throws(() => fingerprintUiComponentDiff({}), /invalid diff/);
});
test("auth and network failures abort instead of publishing unavailable fingerprints", async () => {
  for (const response of [new Response("no", { status: 401 }), new Response("no", { status: 403 })]) {
    const h = harness(); const original = h.options.fetchImpl;
    h.options.fetchImpl = async (url, opts) => String(url).includes("/diff") ? response.clone() : original(url, opts);
    await assert.rejects(analyzeUiComponents(config, h.options), /HTTP (401|403)/);
  }
  const h = harness(); const original = h.options.fetchImpl;
  h.options.fetchImpl = async (url, opts) => {
    if (String(url).includes("/diff")) throw new TypeError("fetch failed");
    return original(url, opts);
  };
  await assert.rejects(analyzeUiComponents(config, h.options), /fetch failed/);
});
