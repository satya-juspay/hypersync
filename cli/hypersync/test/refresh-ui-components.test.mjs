import assert from "node:assert/strict";
import { test } from "node:test";
import { loadUiComponentsRefreshConfig, refreshUiComponents } from "../src/refresh-ui-components.mjs";

const config = {
  hypersyncUrl: "https://hypersync.example.test",
  importToken: "import-test",
  discovery: { bitbucketUrl: "https://bitbucket.example.test", project: "PICAF", token: "bitbucket-secret" },
};
const runId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const sha = (value) => value.toString(16).padStart(40, "0");
const commit = (id, overrides = {}) => ({
  sha: sha(id), displayId: sha(id).slice(0, 12),
  author: { name: "Developer", emailAddress: "developer@example.test" },
  authorTimestamp: Date.parse("2026-01-01"), message: `Commit ${id}`, parents: [sha(1)], ...overrides,
});
const release = (branch = "release-20260101", releaseCommits = [commit(2)], overrides = {}) => ({
  branch, widgetHeadSha: sha(100), uiComponentsRef: "feature-example", uiComponentsRefType: "branch",
  uiComponentsHeadSha: releaseCommits?.length === 0 ? sha(1) : sha(2), uiComponentsBranches: ["feature-example"],
  jenkinsBoundarySha: sha(1), status: "release-commits", warnings: [], error: null, releaseCommits, ...overrides,
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(releases = [release()], handler = () => undefined) {
  const actions = [];
  const logs = [];
  return {
    actions,
    logs,
    options: {
      config, runId, retryDelayMs: 0, heartbeatMs: 60_000,
      onProgress: (message) => logs.push(message),
      inspectImpl: async (discovery, options) => {
        assert.deepEqual(discovery, config.discovery);
        options.onProgress("Inspected test releases");
        return releases;
      },
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://hypersync.example.test/api/ui-components/import");
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, "Bearer import-test");
        assert.equal(options.headers["Content-Type"], "application/json");
        assert.ok(Buffer.byteLength(options.body, "utf8") <= 1_000_000);
        assert.ok(!options.body.includes("bitbucket-secret"));
        assert.ok(options.signal instanceof AbortSignal);
        const body = JSON.parse(options.body);
        assert.equal(body.runId, runId);
        actions.push(body);
        const custom = await handler(body, actions);
        if (custom) return custom;
        if (body.action === "start") return Response.json({ success: true, startedAt: "2026-10-01T00:00:00.000Z" });
        if (body.action === "finish") return Response.json({ success: true, lastSynced: "2026-10-01T00:00:00.000Z", branches: releases.length, commits: 1 });
        return Response.json({ success: true });
      },
    },
  };
}

test("isolated refresh prepares, stages, seals and publishes complete snapshots with unique commits", async () => {
  const shared = commit(2);
  const h = harness([
    release("release-20260102", [shared, shared], { warnings: ["Containing branch plugin unavailable"] }),
    release("release-20260101", [shared]),
    release("release-20260103", [], {
      uiComponentsRef: "v2.56.12", uiComponentsRefType: "version", status: "published-version", jenkinsBoundarySha: null,
    }),
  ]);
  const finished = await refreshUiComponents(h.options);
  assert.equal(finished.success, true);
  assert.deepEqual(h.actions.map((action) => action.action), [
    "start", "prepare", "manifest", "commits", "snapshot-commits", "seal", "snapshot-commits", "seal", "seal", "finish",
  ]);
  assert.deepEqual(h.actions[1].branches, ["release-20260101", "release-20260102", "release-20260103"]);
  assert.deepEqual(h.actions[2].records.map((item) => item.expectedCommitCount), [1, 1, 0]);
  assert.deepEqual(h.actions[3].records, [shared]);
  assert.equal(h.actions.at(-1).expectedBranches, 3);
  assert.ok(h.logs.some((message) => message.includes("3 release branches, 1 unique release commits")));
  assert.ok(h.logs.some((message) => message.includes("Sealed release-20260103: 0 release commits")));
});

test("batches honor record count limits for manifests, commits and per-snapshot links", async () => {
  const manyCommits = Array.from({ length: 251 }, (_, index) => commit(index + 2));
  const manyReleases = Array.from({ length: 55 }, (_, index) => release(`release-2026${String(index + 1).padStart(4, "0")}`, index === 0 ? manyCommits : []));
  const h = harness(manyReleases);
  await refreshUiComponents(h.options);
  assert.deepEqual(h.actions.filter((action) => action.action === "manifest").map((action) => action.records.length), [25, 25, 5]);
  const commitBatches = h.actions.filter((action) => action.action === "commits");
  assert.equal(commitBatches.length, 11);
  assert.ok(commitBatches.every((action) => action.records.length <= 25));
  assert.deepEqual(h.actions.filter((action) => action.action === "snapshot-commits").map((action) => action.commitShas.length), [100, 100, 51]);
  assert.equal(h.actions.filter((action) => action.action === "seal").length, 55);
});

test("batches honor serialized UTF-8 size for large non-ASCII commit messages", async () => {
  const records = Array.from({ length: 12 }, (_, index) => commit(index + 2, { message: "界".repeat(100_000) }));
  const h = harness([release(undefined, records)]);
  await refreshUiComponents(h.options);
  assert.deepEqual(h.actions.filter((action) => action.action === "commits").map((action) => action.records.length), [3, 3, 3, 3]);
});

test("incomplete, empty or invalid inspection aborts without staging a replacement", async (t) => {
  const cases = [
    ["empty", [], /No release branches/],
    ["failed branch", [release(undefined, null, { error: "Bitbucket 500" })], /Inspection incomplete/],
    ["null history", [release(undefined, null)], /Inspection incomplete/],
    ["duplicate branch", [release(), release()], /duplicate release branch/],
    ["missing boundary", [release(undefined, [], { jenkinsBoundarySha: null })], /Invalid inspected snapshot/],
    ["bad commit", [release(undefined, [commit(2, { parents: ["not-sha"] })])], /Invalid release commit/],
    ["Jenkins commit", [release(undefined, [commit(2, { author: { name: "jenkins.user", emailAddress: null } })])], /Jenkins release boundary/],
    ["conflicting commit", [release(undefined, [commit(2), commit(2, { message: "Different" })])], /Conflicting commit metadata/],
    ["oversized commit", [release(undefined, [commit(2, { message: "x".repeat(100_001) })])], /message exceeds 100000/],
    ["oversized manifest", [release(undefined, [commit(2)], { uiComponentsBranches: Array.from({ length: 5000 }, (_, index) => `branch-${index}-${"x".repeat(480)}`) })], /size limit/],
    ["odd SHA length", [release(undefined, [commit(2, { sha: "a".repeat(41) })])], /Invalid release commit/],
    ["malformed semver", [release(undefined, [], { uiComponentsRefType: "version", uiComponentsRef: "v2.1.0+invalid..metadata", status: "published-version", jenkinsBoundarySha: null })], /Invalid inspected snapshot/],
    ["missing head", [release(undefined, [commit(3)])], /must include the dependency head/],
    ["boundary head with changes", [release(undefined, [commit(3)], { uiComponentsHeadSha: sha(1) })], /must include the dependency head/],
    ["ref with whitespace", [release(undefined, [commit(2)], { uiComponentsRef: "feature invalid" })], /Invalid inspected snapshot/],
    ["long reference", [release(undefined, [commit(2)], { uiComponentsRef: "x".repeat(501) })], /Invalid inspected snapshot/],
    ["long warning", [release(undefined, [commit(2)], { warnings: ["x".repeat(2001)] })], /Invalid inspected snapshot/],
    ["too many warnings", [release(undefined, [commit(2)], { warnings: Array(101).fill("warning") })], /Invalid inspected snapshot/],
    ["long branch context", [release(undefined, [commit(2)], { uiComponentsBranches: ["x".repeat(501)] })], /Invalid inspected snapshot/],
    ["short display ID", [release(undefined, [commit(2, { displayId: "000000" })])], /Invalid release commit/],
    ["non-prefix display ID", [release(undefined, [commit(2, { displayId: "fffffff" })])], /Invalid release commit/],
    ["null message char", [release(undefined, [commit(2, { message: "Invalid\0message" })])], /Invalid release commit/],
    ["oversized author", [release(undefined, [commit(2, { author: { name: "x".repeat(5001), emailAddress: null } })])], /Invalid release commit/],
    ["empty author", [release(undefined, [commit(2, { author: { name: " ", emailAddress: " " } })])], /Invalid release commit/],
    ["nonstring author", [release(undefined, [commit(2, { author: { name: 123, emailAddress: null } })])], /Invalid release commit/],
    ["out of range timestamp", [release(undefined, [commit(2, { authorTimestamp: 8_640_000_000_000_001 })])], /Invalid release commit/],
    ["duplicate parent", [release(undefined, [commit(2, { parents: [sha(1), sha(1)] })])], /duplicate parents/],
    ["self parent", [release(undefined, [commit(2, { parents: [sha(2)] })])], /self or duplicate parents/],
  ];
  for (const [name, releases, error] of cases) {
    await t.test(name, async () => {
      const h = harness(releases);
      await assert.rejects(refreshUiComponents(h.options), error);
      assert.deepEqual(h.actions.map((action) => action.action), ["start", "abort"]);
      assert.ok(h.actions.at(-1).error.length <= 500);
    });
  }
});

test("pinned references, heads and display IDs normalize to lowercase before import", async () => {
  const head = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
  const h = harness([release(undefined, [commit(2, { sha: head, displayId: head.slice(0, 12) })], {
    uiComponentsRefType: "commit", uiComponentsRef: head, uiComponentsHeadSha: head,
    widgetHeadSha: head, uiComponentsBranches: [],
  })]);
  await refreshUiComponents(h.options);
  const manifest = h.actions.find((action) => action.action === "manifest").records[0];
  assert.equal(manifest.uiComponentsRef, head.toLowerCase());
  assert.equal(manifest.uiComponentsHeadSha, head.toLowerCase());
  assert.equal(manifest.widgetHeadSha, head.toLowerCase());
  const uploaded = h.actions.find((action) => action.action === "commits").records[0];
  assert.equal(uploaded.sha, head.toLowerCase());
  assert.equal(uploaded.displayId, head.slice(0, 12).toLowerCase());
});

test("import failure aborts only its own run and never finishes", async () => {
  const h = harness(undefined, (body) => body.action === "commits" ? new Response("validation failed", { status: 400 }) : undefined);
  await assert.rejects(refreshUiComponents(h.options), /API 400 \(commits\)/);
  assert.equal(h.actions.at(-1).action, "abort");
  assert.ok(!h.actions.some((action) => action.action === "finish"));
  assert.ok(h.logs.some((message) => message.includes("previously published dataset is unchanged")));
});

test("transient start and finish failures retry idempotently with the same run ID", async () => {
  let starts = 0;
  let finishes = 0;
  const h = harness(undefined, (body) => {
    if (body.action === "start") {
      starts += 1;
      if (starts === 1) throw new TypeError("network connection reset");
      if (starts === 2) return new Response("unavailable", { status: 503 });
    }
    if (body.action === "finish" && ++finishes === 1) return new Response("gateway failure", { status: 502 });
  });
  await refreshUiComponents(h.options);
  assert.equal(starts, 3);
  assert.equal(finishes, 2);
  assert.ok(!h.actions.some((action) => action.action === "abort"));
});

test("start and finish retry transport failures while reading successful response bodies", async () => {
  let starts = 0;
  let finishes = 0;
  const h = harness(undefined, (body) => {
    if ((body.action === "start" && ++starts === 1) || (body.action === "finish" && ++finishes === 1)) {
      return { ok: true, json: async () => { throw new TypeError("response connection terminated"); } };
    }
  });
  await refreshUiComponents(h.options);
  assert.equal(starts, 2);
  assert.equal(finishes, 2);
  assert.ok(!h.actions.some((action) => action.action === "abort"));
});

test("malformed response JSON is not retried as a network failure", async () => {
  const h = harness(undefined, (body) => body.action === "start" ? new Response("not-json") : undefined);
  await assert.rejects(refreshUiComponents(h.options), /invalid JSON \(start\)/);
  assert.deepEqual(h.actions.map((action) => action.action), ["start", "abort"]);
});

test("abort retries transient failures and preserves the inspection failure", async () => {
  let aborts = 0;
  const h = harness([], (body) => {
    if (body.action === "abort" && ++aborts < 3) return new Response("unavailable", { status: 504 });
  });
  await assert.rejects(refreshUiComponents(h.options), /No release branches/);
  assert.equal(aborts, 3);
  assert.deepEqual(h.actions.slice(1).map((action) => action.error), Array(3).fill(h.actions[1].error));
});

test("start conflict is not retried and does not abort another refresh", async () => {
  const h = harness(undefined, (body) => body.action === "start" ? new Response("refresh already running", { status: 409 }) : undefined);
  h.options.inspectImpl = () => assert.fail("Inspection must not run without a lease");
  await assert.rejects(refreshUiComponents(h.options), /API 409/);
  assert.deepEqual(h.actions.map((action) => action.action), ["start"]);
});

test("unconfirmed start exhausts retries then attempts cleanup using only its own run ID", async () => {
  const h = harness(undefined, (body) => {
    if (body.action === "start") throw new TypeError("fetch failed");
  });
  await assert.rejects(refreshUiComponents(h.options), /request failed \(start\)/);
  assert.deepEqual(h.actions.map((action) => action.action), ["start", "start", "start", "abort"]);
});

test("heartbeat failure stops future Bitbucket requests and prevents staging or finishing", async () => {
  const h = harness(undefined, (body) => body.action === "heartbeat" ? new Response("lease revoked", { status: 409 }) : undefined);
  h.options.heartbeatMs = 2;
  let bitbucketRequests = 0;
  h.options.inspectImpl = async (_config, options) => {
    await wait(20);
    await options.fetchImpl("https://bitbucket.example.test/commits");
    return [release()];
  };
  const serverFetch = h.options.fetchImpl;
  h.options.fetchImpl = async (url, options) => {
    if (String(url).includes("bitbucket.example.test")) bitbucketRequests += 1;
    return serverFetch(url, options);
  };
  await assert.rejects(refreshUiComponents(h.options), /API 409 \(heartbeat\)/);
  assert.equal(bitbucketRequests, 0);
  assert.deepEqual(h.actions.map((action) => action.action), ["start", "heartbeat", "abort"]);
});

test("heartbeat renewals never overlap and stop before final publication", async () => {
  let inFlight = 0;
  let renewals = 0;
  const h = harness(undefined, async (body) => {
    if (body.action === "heartbeat") {
      inFlight += 1;
      renewals += 1;
      assert.equal(inFlight, 1);
      await wait(10);
      inFlight -= 1;
    }
    if (body.action === "finish") assert.equal(inFlight, 0);
  });
  h.options.heartbeatMs = 2;
  h.options.inspectImpl = async () => { await wait(25); return [release()]; };
  await refreshUiComponents(h.options);
  assert.ok(renewals >= 1);
  const total = h.actions.length;
  await wait(10);
  assert.equal(h.actions.length, total);
});

test("in-flight heartbeat failures are not suppressed while stopping for publication", async () => {
  let heartbeatStarted;
  const observedHeartbeat = new Promise((resolve) => { heartbeatStarted = resolve; });
  const h = harness(undefined, async (body) => {
    if (body.action === "heartbeat") {
      heartbeatStarted();
      await wait(15);
      return new Response("lease lost", { status: 409 });
    }
  });
  h.options.heartbeatMs = 2;
  h.options.inspectImpl = async () => { await observedHeartbeat; return [release()]; };
  await assert.rejects(refreshUiComponents(h.options), /API 409 \(heartbeat\)/);
  assert.equal(h.actions.at(-1).action, "abort");
  assert.ok(!h.actions.some((action) => action.action === "finish"));
});

test("config permits HTTPS and HTTP loopback only, and does not need old refresh API settings", () => {
  const env = { HYPERSYNC_URL: "https://app.example.test/", HYPERSYNC_IMPORT_TOKEN: "import-test", BITBUCKET_TOKEN: "bitbucket-test", BITBUCKET_REPO: "wrong-repo" };
  const loaded = loadUiComponentsRefreshConfig(env);
  assert.equal(loaded.hypersyncUrl, "https://app.example.test");
  assert.equal(loaded.discovery.project, "PICAF");
  assert.equal(loaded.discovery.token, "bitbucket-test");
  for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.ok(loadUiComponentsRefreshConfig({ ...env, HYPERSYNC_URL: url }));
  }
  for (const url of ["http://app.example.test", "https://username:secret@app.example.test", "https://app.example.test/subpath", "https://app.example.test?x=1", "file:///tmp/app"]) {
    assert.throws(() => loadUiComponentsRefreshConfig({ ...env, HYPERSYNC_URL: url }), /HTTPS app origin/);
  }
  assert.throws(() => loadUiComponentsRefreshConfig({ ...env, HYPERSYNC_IMPORT_TOKEN: "" }), /Missing HYPERSYNC_IMPORT_TOKEN/);
  assert.throws(() => loadUiComponentsRefreshConfig({ ...env, BITBUCKET_TOKEN: "" }), /Missing BITBUCKET_TOKEN/);
});
