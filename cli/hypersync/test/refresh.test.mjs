import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { refresh, createPatchFingerprint } from "../src/refresh.mjs";

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

  await refresh({ fingerprintLimit: 0 });
  assert.deepEqual(actions.map((action) => action.action), ["start", "batch", "finish"]);
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

  await refresh({ fingerprintLimit: 0 });
  assert.equal(requests.length, 3);
  assert.deepEqual(actions.map((action) => action.action), ["start", "batch", "finish"]);
  assert.deepEqual(actions[1].records.map((record) => record.kind), ["release", "main", "main"]);
});

test("fingerprint format matches the dashboard scorer", () => {
  assert.equal(createPatchFingerprint("--- a/a.ts\n+++ b/a.ts\n-old\n+new\n"), "a.ts\t+new\na.ts\t-old");
});
