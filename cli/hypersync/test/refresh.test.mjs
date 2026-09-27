import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createPatchFingerprint, refresh } from "../src/refresh.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = {
  HYPERSYNC_URL: process.env.HYPERSYNC_URL,
  HYPERSYNC_IMPORT_TOKEN: process.env.HYPERSYNC_IMPORT_TOKEN,
  BITBUCKET_TOKEN: process.env.BITBUCKET_TOKEN,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("refresh uploads eligible PRs and advances the cursor", async () => {
  process.env.HYPERSYNC_URL = "https://hypersync.example.test";
  process.env.HYPERSYNC_IMPORT_TOKEN = "import-test";
  process.env.BITBUCKET_TOKEN = "bitbucket-test";
  const actions = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/api/import")) {
      assert.equal(options.headers.Authorization, "Bearer import-test");
      const body = JSON.parse(options.body);
      actions.push(body);
      if (body.action === "start") return Response.json({ since: "2026-01-01T00:00:00.000Z" });
      if (body.action === "finish") return Response.json({ lastSynced: "2026-09-25T00:00:00.000Z" });
      return Response.json({ success: true });
    }
    assert.equal(options.headers.Authorization, "Bearer bitbucket-test");
    if (target.endsWith(".diff")) {
      return new Response("--- a/a.ts\n+++ b/a.ts\n-old\n+new\n");
    }
    const query = new URL(target).searchParams;
    assert.equal(query.get("order"), "NEWEST");
    assert.equal(query.get("limit"), "100");
    if (query.get("at") === "refs/heads/master") return Response.json({ values: [], isLastPage: true });
    if (query.get("state") === "MERGED") return Response.json({
      values: [
        {
          id: 10, state: "MERGED", title: "release", updatedDate: Date.parse("2026-02-01"),
          closedDate: Date.parse("2026-02-01"), toRef: { displayId: "release-2026" },
          fromRef: { displayId: "devqa-PICAF-123" }, author: { user: { emailAddress: "a@example.com" } },
        },
        {
          id: 12, state: "OPEN", updatedDate: Date.parse("2026-02-02"),
          toRef: { displayId: "feature" },
        },
      ],
      isLastPage: true,
    });
    assert.equal(query.get("at"), "refs/heads/main");
    assert.equal(query.get("direction"), "INCOMING");
    return Response.json({ values: [{
      id: 11, state: "OPEN", title: "main", updatedDate: Date.parse("2026-02-02"),
      toRef: { displayId: "main" }, fromRef: { displayId: "devqa-PICAF-123" },
    }], isLastPage: true });
  };

  await refresh({ delayMs: 0 });
  assert.equal(actions[0].action, "start");
  assert.equal(actions.at(-1).action, "finish");
  assert.deepEqual(
    actions.filter((action) => action.action === "pending").map((action) => action.kind),
    ["release", "main"]
  );
  assert.equal(actions[1].records.length, 2);
  assert.equal(actions[1].records[0].kind, "release");
  assert.equal(actions[1].records[1].kind, "main");
  assert.equal(actions[1].records[0].sourceBranch, "devqa-PICAF-123");
});

test("refresh stops at the cursor without scanning older pages", async () => {
  process.env.HYPERSYNC_URL = "https://hypersync.example.test";
  process.env.HYPERSYNC_IMPORT_TOKEN = "import-test";
  process.env.BITBUCKET_TOKEN = "bitbucket-test";
  const requests = [];
  const actions = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/api/import")) {
      const body = JSON.parse(options.body);
      actions.push(body);
      if (body.action === "start") return Response.json({ since: "2026-09-24T00:00:00.000Z" });
      if (body.action === "finish") return Response.json({ lastSynced: "2026-09-25T00:00:00.000Z" });
      return Response.json({ success: true });
    }
    if (target.endsWith(".diff")) {
      return new Response("--- a/a.ts\n+++ b/a.ts\n-old\n+new\n");
    }
    const query = new URL(target).searchParams;
    requests.push(query);
    assert.equal(query.get("start"), "0");
    const branch = query.get("at")?.split("/").at(-1) || "release-2026";
    return Response.json({
      values: [
        { id: requests.length, state: "MERGED", updatedDate: Date.parse("2026-09-25"), toRef: { displayId: branch } },
        { id: 100 + requests.length, state: "MERGED", updatedDate: Date.parse("2026-09-23"), toRef: { displayId: branch } },
      ],
      isLastPage: false,
      nextPageStart: 2,
    });
  };

  await refresh({ delayMs: 0 });
  assert.equal(requests.length, 3);
  assert.equal(actions[0].action, "start");
  assert.equal(actions.at(-1).action, "finish");
  assert.deepEqual(actions[1].records.map((record) => record.kind), ["release", "main", "main"]);
});

test("fingerprint format matches the dashboard scorer", () => {
  const fingerprint = createPatchFingerprint(
    "--- a/a.ts\n+++ b/a.ts\n-old\n+new\n"
  );
  assert.match(fingerprint, /^v2\nF:[A-Za-z0-9_-]{43}\nA:[A-Za-z0-9_-]{43}\nR:[A-Za-z0-9_-]{43}$/);
  assert.ok(!fingerprint.includes("a.ts"));
  assert.ok(!fingerprint.includes("old"));
  assert.ok(!fingerprint.includes("new"));
});

test("refresh exhausts release and main fingerprints before advancing the cursor", async () => {
  process.env.HYPERSYNC_URL = "https://hypersync.example.test";
  process.env.HYPERSYNC_IMPORT_TOKEN = "import-test";
  process.env.BITBUCKET_TOKEN = "bitbucket-test";
  const actions = [];
  const pendingCalls = { release: 0, main: 0 };

  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/api/import")) {
      const body = JSON.parse(options.body);
      actions.push(body);
      if (body.action === "start") {
        return Response.json({ since: "2026-09-25T00:00:00.000Z" });
      }
      if (body.action === "finish") {
        return Response.json({ lastSynced: "2026-09-26T00:00:00.000Z" });
      }
      if (body.action === "pending") {
        assert.equal(body.limit, 50);
        pendingCalls[body.kind] += 1;
        if (pendingCalls[body.kind] > 1) {
          if (body.kind === "main") {
            assert.deepEqual(body.excludeIds, ["6648"]);
          }
          return Response.json({ success: true, records: [] });
        }
        return Response.json({
          success: true,
          records: body.kind === "release"
            ? [{ id: "7704", kind: "release" }]
            : [
                { id: "6262", kind: "main" },
                { id: "6648", kind: "main" },
                { id: "7705", kind: "main" },
              ],
        });
      }
      return Response.json({ success: true });
    }

    const parsed = new URL(target);
    if (parsed.searchParams.has("state")) {
      return Response.json({ values: [], isLastPage: true });
    }
    if (target.endsWith("/7704.diff")) {
      return new Response("--- a/a.ts\n+++ b/a.ts\n-old\n+new\n");
    }
    if (target.endsWith("/7705.diff")) {
      return new Response("--- a/a.ts\n+++ b/a.ts\n-old\n+new\n");
    }
    if (target.endsWith("/6262.diff")) {
      return new Response(`--- a/large.ts\n+++ b/large.ts\n+${"x".repeat(200_001)}\n`);
    }
    if (target.endsWith("/6648.diff")) {
      return new Response("temporary Bitbucket Git failure", { status: 500 });
    }
    const id = Number(target.split("/").at(-1));
    const release = id === 7704;
    return Response.json({
      id,
      state: release ? "MERGED" : "OPEN",
      title: release ? "release" : "main",
      closedDate: release ? Date.parse("2026-09-25") : undefined,
      toRef: { displayId: release ? "release-20260915" : "main" },
      fromRef: { displayId: `devqa-HYPSDK-${id}` },
      author: { user: { emailAddress: "a@example.com", displayName: "A" } },
    });
  };

  await refresh({ delayMs: 0 });

  const fingerprintBatches = actions.filter(
    (action) => action.action === "batch" && action.records?.[0]?.patchFingerprint !== undefined
  );
  assert.deepEqual(
    fingerprintBatches.map((action) => [action.records[0].id, action.records[0].kind]),
    [["7704", "release"], ["6262", "main"], ["7705", "main"]]
  );
  assert.deepEqual(
    actions
      .filter((action) => action.action === "fingerprint-failed")
      .map(({ id, kind }) => [id, kind]),
    [["6648", "main"]]
  );
  assert.equal(actions.at(-1).action, "finish");
});

test("refresh does not request diffs for PRs previously marked with Bitbucket HTTP 500", async () => {
  process.env.HYPERSYNC_URL = "https://hypersync.example.test";
  process.env.HYPERSYNC_IMPORT_TOKEN = "import-test";
  process.env.BITBUCKET_TOKEN = "bitbucket-test";
  const actions = [];
  const diffRequests = [];

  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/api/import")) {
      const body = JSON.parse(options.body);
      actions.push(body);
      if (body.action === "start") {
        return Response.json({
          since: "2026-09-25T00:00:00.000Z",
          fingerprintFailures: { release: [], main: ["6648"] },
        });
      }
      if (body.action === "pending") {
        return Response.json({ success: true, records: [] });
      }
      if (body.action === "finish") {
        return Response.json({ lastSynced: "2026-09-26T00:00:00.000Z" });
      }
      return Response.json({ success: true });
    }

    if (target.endsWith(".diff")) {
      diffRequests.push(target);
      return new Response("should not be requested", { status: 500 });
    }

    const query = new URL(target).searchParams;
    if (query.get("state") === "MERGED" || query.get("at") === "refs/heads/master") {
      return Response.json({ values: [], isLastPage: true });
    }
    return Response.json({
      values: [{
        id: 6648,
        state: "OPEN",
        title: "main",
        updatedDate: Date.parse("2026-09-26"),
        toRef: { displayId: "main" },
        fromRef: { displayId: "devqa-HYPSDK-123" },
      }],
      isLastPage: true,
    });
  };

  await refresh({ delayMs: 0 });

  assert.deepEqual(diffRequests, []);
  assert.equal(actions.at(-1).action, "finish");
});
