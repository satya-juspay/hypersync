import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function moduleUrl(path, replacements = {}) {
  let source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}

const validationUrl = moduleUrl("../lib/ui-component-import-validation.ts");
const { UiComponentImportValidationError } = await import(validationUrl);
const analysisValidationUrl = moduleUrl("../lib/ui-component-analysis-validation.ts", {
  '"./ui-component-import-validation"': JSON.stringify(validationUrl),
});
const storeUrl = moduleUrl("../lib/ui-component-import-store.ts", {
  '"./ui-component-import-validation"': JSON.stringify(validationUrl),
  '"./ui-component-analysis-validation"': JSON.stringify(analysisValidationUrl),
});
const { createUiComponentImporter, UiComponentImportConflict } = await import(storeUrl);

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN = "22222222-2222-4222-8222-222222222222";
const OLD_RUN = "33333333-3333-4333-8333-333333333333";
const BRANCH = "release-20260929";
const OTHER_BRANCH = "release-20260928";
const VERSION_BRANCH = "release-20260921";
const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const BOUNDARY = "c".repeat(40);

function snapshot(overrides = {}) {
  return {
    branch: BRANCH,
    widgetHeadSha: "d".repeat(40),
    uiComponentsRef: HEAD,
    uiComponentsRefType: "commit",
    uiComponentsHeadSha: HEAD,
    uiComponentsBranches: ["devqa-widget"],
    jenkinsBoundarySha: BOUNDARY,
    status: "release-commits",
    warnings: [],
    expectedCommitCount: 1,
    ...overrides,
  };
}

function versionSnapshot(overrides = {}) {
  return snapshot({
    branch: VERSION_BRANCH,
    uiComponentsRef: "v2.63.3",
    uiComponentsRefType: "version",
    jenkinsBoundarySha: null,
    status: "published-version",
    expectedCommitCount: 0,
    ...overrides,
  });
}

function commit(sha = HEAD, overrides = {}) {
  return {
    sha,
    displayId: sha.slice(0, 12),
    author: { name: "developer", emailAddress: "developer@example.com" },
    authorTimestamp: 1_790_000_000_000,
    message: "fix: styling",
    parents: [BOUNDARY],
    ...overrides,
  };
}

// Deliberately expose only the isolated UI Components delegates. Accessing
// an existing production table or making a model call outside a transaction
// fails these tests immediately. Transactions are serialized and roll back
// all Maps on failure, including any lease extension performed by the guard.
function fakeDatabase() {
  const models = [
    "uiComponentSyncStatus", "uiComponentRefreshRun", "uiComponentReleaseSnapshot",
    "uiComponentReleaseCommit", "uiComponentSnapshotCommit",
    "uiComponentMainPr", "uiComponentCommitAnalysis", "uiComponentDiffFailure",
  ];
  let tables = Object.fromEntries(models.map((name) => [name, new Map()]));
  const trace = [];
  let tail = Promise.resolve();
  let transactionCount = 0;

  function key(model, row) {
    if (model === "uiComponentMainPr") return `${row.runId}:${row.prId}`;
    if (model === "uiComponentCommitAnalysis") return `${row.runId}:${row.commitSha}`;
    if (model === "uiComponentDiffFailure") return row.key;
    if (model === "uiComponentReleaseCommit") return row.sha;
    if (model === "uiComponentSnapshotCommit") return `${row.snapshotId}:${row.commitSha}`;
    return row.id;
  }

  function matches(model, row, where = {}) {
    return Object.entries(where).every(([field, condition]) => {
      if (field === "OR") return condition.some((clause) => matches(model, row, clause));
      if (["runId_branch", "snapshotId_commitSha", "runId_prId", "runId_commitSha"].includes(field)) return matches(model, row, condition);
      if (field === "snapshots") {
        assert.equal(model, "uiComponentReleaseCommit");
        const runId = condition.some.snapshot.runId;
        return [...tables.uiComponentSnapshotCommit.values()].some((link) =>
          link.commitSha === row.sha && tables.uiComponentReleaseSnapshot.get(link.snapshotId)?.runId === runId);
      }
      if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
        return Object.entries(condition).every(([operator, value]) => {
          if (operator === "in") return value.includes(row[field]);
          if (operator === "gt") return row[field] !== null && row[field] > value;
          if (operator === "lte") return row[field] !== null && row[field] <= value;
          throw new Error(`Unsupported fake where operator: ${operator}`);
        });
      }
      return row[field] === condition;
    });
  }

  function defaults(model, data) {
    if (model === "uiComponentSyncStatus") {
      return { runId: null, leaseUntil: null, activeRunId: null, lastSynced: null, ...data };
    }
    if (model === "uiComponentRefreshRun") {
      return { status: "RUNNING", startedAt: new Date(), finishedAt: null, error: null, branchManifest: [], branchCount: 0, commitCount: 0, analysisVersion: 0, mainPrManifest: [], analysisManifest: [], mainPrCount: 0, ...data };
    }
    if (model === "uiComponentReleaseSnapshot") return { sealed: false, createdAt: new Date(), ...data };
    if (model === "uiComponentReleaseCommit") return { createdAt: new Date(), ...data };
    return data;
  }

  function project(model, row, args) {
    if (!row) return null;
    const result = structuredClone(row);
    if (args.include?._count?.select?.commits) {
      result._count = { commits: [...tables.uiComponentSnapshotCommit.values()].filter((link) => link.snapshotId === row.id).length };
    }
    if (args.select) return Object.fromEntries(Object.keys(args.select).map((field) => [field, result[field]]));
    return result;
  }

  function delegate(model, transactionId, isActive) {
    const methods = {
      async findUnique(args) {
        const row = [...tables[model].values()].find((item) => matches(model, item, args.where));
        return project(model, row, args);
      },
      async findMany(args) {
        return [...tables[model].values()].filter((row) => matches(model, row, args.where)).map((row) => project(model, row, args));
      },
      async count(args) {
        return [...tables[model].values()].filter((row) => matches(model, row, args.where)).length;
      },
      async create(args) {
        const row = structuredClone(defaults(model, args.data));
        const id = key(model, row);
        assert.ok(!tables[model].has(id), `duplicate fake ${model} primary key`);
        tables[model].set(id, row);
        return structuredClone(row);
      },
      async upsert(args) {
        const row = [...tables[model].values()].find((item) => matches(model, item, args.where));
        if (row) {
          Object.assign(row, structuredClone(args.update));
          return structuredClone(row);
        }
        return methods.create({ data: args.create });
      },
      async update(args) {
        const row = [...tables[model].values()].find((item) => matches(model, item, args.where));
        assert.ok(row, `missing fake ${model} row for update`);
        Object.assign(row, structuredClone(args.data));
        return structuredClone(row);
      },
      async updateMany(args) {
        const rows = [...tables[model].values()].filter((row) => matches(model, row, args.where));
        for (const row of rows) Object.assign(row, structuredClone(args.data));
        return { count: rows.length };
      },
      async createMany(args) {
        let count = 0;
        for (const data of args.data) {
          assert.equal(model, "uiComponentSnapshotCommit");
          assert.ok(tables.uiComponentReleaseSnapshot.has(data.snapshotId), "snapshot foreign key");
          assert.ok(tables.uiComponentReleaseCommit.has(data.commitSha), "commit foreign key");
          const id = key(model, data);
          if (args.skipDuplicates && tables[model].has(id)) continue;
          assert.ok(!tables[model].has(id), "join primary key");
          tables[model].set(id, structuredClone(data));
          count++;
        }
        return { count };
      },
    };
    return new Proxy(methods, {
      get(target, method) {
        assert.ok(method in target, `unsupported ${model}.${String(method)}`);
        return async (args) => {
          assert.ok(isActive(), "model access must remain inside its transaction");
          trace.push({ transactionId, model, method, args: structuredClone(args) });
          return target[method](args);
        };
      },
    });
  }

  const db = new Proxy({
    $transaction(action, options) {
      const operation = tail.then(async () => {
        const transactionId = ++transactionCount;
        const before = structuredClone(tables);
        trace.push({ transactionId, event: "begin", options });
        let active = true;
        const tx = new Proxy(Object.fromEntries(models.map((model) => [model, delegate(model, transactionId, () => active)])), {
          get(target, model) {
            assert.ok(model in target, `unexpected production model access: ${String(model)}`);
            return target[model];
          },
        });
        try {
          const result = await action(tx);
          trace.push({ transactionId, event: "commit" });
          return result;
        } catch (error) {
          tables = before;
          trace.push({ transactionId, event: "rollback" });
          throw error;
        } finally {
          active = false;
        }
      });
      tail = operation.catch(() => {});
      return operation;
    },
  }, {
    get(target, method) {
      assert.equal(method, "$transaction", "all database accesses must use transactions");
      return target[method];
    },
  });

  return {
    db,
    trace,
    get tables() { return tables; },
    get transactionCount() { return transactionCount; },
    checkpoint() { return structuredClone(tables); },
    expire() { tables.uiComponentSyncStatus.get("singleton").leaseUntil = new Date(0); },
    seedActiveRun() {
      const finishedAt = new Date("2026-09-25T00:00:00Z");
      tables.uiComponentRefreshRun.set(OLD_RUN, defaults("uiComponentRefreshRun", { id: OLD_RUN, status: "COMPLETED", finishedAt, branchCount: 1, commitCount: 3 }));
      tables.uiComponentSyncStatus.set("singleton", defaults("uiComponentSyncStatus", { id: "singleton", activeRunId: OLD_RUN, lastSynced: finishedAt }));
    },
  };
}

function setup({ oldActive = false } = {}) {
  const fake = fakeDatabase();
  if (oldActive) fake.seedActiveRun();
  return { fake, importer: createUiComponentImporter(fake.db) };
}

async function stageOne(importer, runId = RUN) {
  await importer.start(runId);
  await importer.prepare(runId, [BRANCH]);
  await importer.manifest(runId, [snapshot()]);
  await importer.commits(runId, [commit()]);
  await importer.snapshotCommits(runId, BRANCH, [HEAD]);
  await importer.seal(runId, BRANCH);
}

async function rejects(action, ErrorType = UiComponentImportValidationError, pattern) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof ErrorType, `unexpected error type: ${error.name}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("start, heartbeat and staged writes use only isolated new tables in guarded transactions", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  await importer.heartbeat(RUN);
  assert.equal(fake.transactionCount, 7);
  assert.ok(fake.trace.filter((entry) => entry.event === "begin").every((entry) => entry.options.maxWait === 10_000 && entry.options.timeout === 30_000));
  for (let transactionId = 2; transactionId <= fake.transactionCount; transactionId++) {
    const calls = fake.trace.filter((entry) => entry.transactionId === transactionId && entry.model);
    assert.equal(calls[0].model, "uiComponentSyncStatus");
    assert.equal(calls[0].method, "updateMany");
    assert.equal(calls[0].args.where.runId, RUN);
    assert.ok(calls[0].args.where.leaseUntil.gt instanceof Date);
  }
});

test("starting the same live run is idempotent and renews its lease", async () => {
  const { importer, fake } = setup();
  const started = await importer.start(RUN);
  fake.tables.uiComponentSyncStatus.get("singleton").leaseUntil = new Date(Date.now() + 1000);
  const beforeLease = fake.tables.uiComponentSyncStatus.get("singleton").leaseUntil;
  assert.deepEqual(await importer.start(RUN), started);
  assert.ok(fake.tables.uiComponentSyncStatus.get("singleton").leaseUntil > beforeLease);
  assert.equal(fake.tables.uiComponentRefreshRun.size, 1);
});

test("competing starts allow only one run to acquire the lease", async () => {
  const { importer, fake } = setup();
  const results = await Promise.allSettled([importer.start(RUN), importer.start(OTHER_RUN)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(results.find((result) => result.status === "rejected").reason instanceof UiComponentImportConflict);
  assert.equal(fake.tables.uiComponentRefreshRun.size, 1);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").runId, RUN);
});

test("foreign owners cannot heartbeat, stage, seal, finish or abort a live run", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  const before = fake.checkpoint();
  const actions = [
    () => importer.heartbeat(OTHER_RUN),
    () => importer.prepare(OTHER_RUN, [BRANCH]),
    () => importer.manifest(OTHER_RUN, [snapshot()]),
    () => importer.commits(OTHER_RUN, [commit()]),
    () => importer.snapshotCommits(OTHER_RUN, BRANCH, [HEAD]),
    () => importer.seal(OTHER_RUN, BRANCH),
    () => importer.finish(OTHER_RUN, 1),
    () => importer.abort(OTHER_RUN, "foreign cancellation"),
  ];
  for (const action of actions) await rejects(action, UiComponentImportConflict);
  assert.deepEqual(fake.tables, before);
});

test("expired leases reject writes and roll back any attempted transaction", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  fake.expire();
  const before = fake.checkpoint();
  await rejects(() => importer.heartbeat(RUN), UiComponentImportConflict, /expired/);
  await rejects(() => importer.commits(RUN, [commit()]), UiComponentImportConflict);
  assert.deepEqual(fake.tables, before);
  assert.equal(fake.trace.at(-1).event, "rollback");
});

test("a live lease without a running run does not permit writes or persist its renewal", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  fake.tables.uiComponentRefreshRun.get(RUN).status = "FAILED";
  fake.tables.uiComponentSyncStatus.get("singleton").leaseUntil = new Date(Date.now() + 1000);
  const before = fake.checkpoint();
  await rejects(() => importer.commits(RUN, [commit()]), UiComponentImportConflict, /not running/);
  assert.deepEqual(fake.tables, before);
  assert.equal(fake.trace.at(-1).event, "rollback");
});

test("prepare sorts and freezes the declared branch manifest idempotently", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  assert.deepEqual(await importer.prepare(RUN, [BRANCH, OTHER_BRANCH]), { expectedBranches: 2 });
  assert.deepEqual(await importer.prepare(RUN, [OTHER_BRANCH, BRANCH]), { expectedBranches: 2 });
  assert.deepEqual(fake.tables.uiComponentRefreshRun.get(RUN).branchManifest, [OTHER_BRANCH, BRANCH]);
  const before = fake.checkpoint();
  await rejects(() => importer.prepare(RUN, [BRANCH]), UiComponentImportValidationError, /cannot change/);
  assert.deepEqual(fake.tables, before);
});

test("snapshots cannot be staged before prepare or outside the declared branch set", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await rejects(() => importer.manifest(RUN, [snapshot()]), UiComponentImportValidationError, /prepare/);
  await importer.prepare(RUN, [OTHER_BRANCH]);
  await rejects(() => importer.manifest(RUN, [snapshot()]), UiComponentImportValidationError, /declared manifest/);
  assert.equal(fake.tables.uiComponentReleaseSnapshot.size, 0);
});

test("manifest retries preserve immutable snapshot metadata and normalize branch context order", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH]);
  await importer.manifest(RUN, [snapshot({ uiComponentsBranches: ["z-feature", "a-feature"] })]);
  await importer.manifest(RUN, [snapshot({ uiComponentsBranches: ["a-feature", "z-feature"] })]);
  assert.equal(fake.tables.uiComponentReleaseSnapshot.size, 1);
  assert.deepEqual(fake.tables.uiComponentReleaseSnapshot.get(`${RUN}:${BRANCH}`).uiComponentsBranches, ["a-feature", "z-feature"]);
  const before = fake.checkpoint();
  await rejects(() => importer.manifest(RUN, [snapshot({ uiComponentsBranches: ["changed"] })]), UiComponentImportValidationError, /metadata cannot change/);
  assert.deepEqual(fake.tables, before);
});

test("failed manifest batches roll back new snapshots and their lease extension", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH, OTHER_BRANCH]);
  await importer.manifest(RUN, [snapshot({ branch: OTHER_BRANCH })]);
  const before = fake.checkpoint();
  await rejects(() => importer.manifest(RUN, [snapshot(), snapshot({ branch: OTHER_BRANCH, widgetHeadSha: "e".repeat(40) })]));
  assert.deepEqual(fake.tables, before);
  assert.equal(fake.trace.at(-1).event, "rollback");
});

test("commit retries are idempotent and global commit metadata is immutable", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.commits(RUN, [commit()]);
  await importer.commits(RUN, [commit(HEAD, { displayId: HEAD.slice(0, 7) })]);
  assert.equal(fake.tables.uiComponentReleaseCommit.size, 1);
  assert.equal(fake.tables.uiComponentReleaseCommit.get(HEAD).displayId, HEAD.slice(0, 12));
  const before = fake.checkpoint();
  await rejects(() => importer.commits(RUN, [commit(HEAD, { message: "changed metadata" })]), UiComponentImportValidationError, /immutable metadata conflicts/);
  assert.deepEqual(fake.tables, before);
});

test("failed commit batches roll back earlier insertions and keep existing metadata", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.commits(RUN, [commit()]);
  const before = fake.checkpoint();
  await rejects(() => importer.commits(RUN, [commit(OTHER_HEAD), commit(HEAD, { parents: [] })]));
  assert.deepEqual(fake.tables, before);
});

test("commit metadata remains immutable when a later refresh references the same SHA", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.commits(RUN, [commit()]);
  await importer.abort(RUN);
  await importer.start(OTHER_RUN);
  await importer.commits(OTHER_RUN, [commit()]);
  const before = fake.checkpoint();
  await rejects(() => importer.commits(OTHER_RUN, [commit(HEAD, { author: { name: "different", emailAddress: null } })]), UiComponentImportValidationError, /immutable/);
  assert.deepEqual(fake.tables, before);
  assert.equal(fake.tables.uiComponentReleaseCommit.size, 1);
});

test("snapshot links require an existing snapshot, uploaded metadata and no Jenkins boundary", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH, VERSION_BRANCH]);
  await rejects(() => importer.snapshotCommits(RUN, BRANCH, [HEAD]), UiComponentImportValidationError, /has not been staged/);
  await importer.manifest(RUN, [snapshot(), versionSnapshot()]);
  await rejects(() => importer.snapshotCommits(RUN, BRANCH, [HEAD]), UiComponentImportValidationError, /upload commit metadata first/);
  await rejects(() => importer.snapshotCommits(RUN, BRANCH, [BOUNDARY]), UiComponentImportValidationError, /Jenkins boundary/);
  await rejects(() => importer.snapshotCommits(RUN, VERSION_BRANCH, [HEAD]), UiComponentImportValidationError, /version/);
  assert.equal(fake.tables.uiComponentSnapshotCommit.size, 0);
});

test("snapshot link retries are idempotent and reject too many commits", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH]);
  await importer.manifest(RUN, [snapshot()]);
  await importer.commits(RUN, [commit(), commit(OTHER_HEAD)]);
  await importer.snapshotCommits(RUN, BRANCH, [HEAD]);
  await importer.snapshotCommits(RUN, BRANCH, [HEAD]);
  assert.equal(fake.tables.uiComponentSnapshotCommit.size, 1);
  const before = fake.checkpoint();
  await rejects(() => importer.snapshotCommits(RUN, BRANCH, [OTHER_HEAD]), UiComponentImportValidationError, /too many/);
  assert.deepEqual(fake.tables, before);
});

test("seal checks complete counts and requires the exact dependency head", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH]);
  await importer.manifest(RUN, [snapshot()]);
  await rejects(() => importer.seal(RUN, BRANCH), UiComponentImportValidationError, /incomplete/);
  await importer.commits(RUN, [commit(OTHER_HEAD)]);
  await importer.snapshotCommits(RUN, BRANCH, [OTHER_HEAD]);
  await rejects(() => importer.seal(RUN, BRANCH), UiComponentImportValidationError, /pinned head/);
  assert.equal(fake.tables.uiComponentReleaseSnapshot.get(`${RUN}:${BRANCH}`).sealed, false);
});

test("sealed snapshots accept retries but their links can never change", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  assert.deepEqual(await importer.seal(RUN, BRANCH), { branch: BRANCH, commits: 1 });
  await importer.snapshotCommits(RUN, BRANCH, [HEAD]);
  await importer.commits(RUN, [commit(OTHER_HEAD)]);
  const before = fake.checkpoint();
  await rejects(() => importer.snapshotCommits(RUN, BRANCH, [OTHER_HEAD]), UiComponentImportValidationError, /sealed links cannot change/);
  assert.deepEqual(fake.tables, before);
});

test("zero-commit published versions and Jenkins heads seal without links", async () => {
  const { importer, fake } = setup();
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH, VERSION_BRANCH]);
  await importer.manifest(RUN, [versionSnapshot(), snapshot({ jenkinsBoundarySha: HEAD, expectedCommitCount: 0 })]);
  await importer.seal(RUN, VERSION_BRANCH);
  await importer.seal(RUN, BRANCH);
  const result = await importer.finish(RUN, 2);
  assert.equal(result.branches, 2);
  assert.equal(result.commits, 0);
  assert.equal(fake.tables.uiComponentSnapshotCommit.size, 0);
});

test("finish publishes only complete sealed snapshots and counts commits uniquely across branches", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH, OTHER_BRANCH, VERSION_BRANCH]);
  await importer.manifest(RUN, [
    snapshot({ expectedCommitCount: 2 }),
    snapshot({ branch: OTHER_BRANCH, uiComponentsRef: OTHER_HEAD, uiComponentsHeadSha: OTHER_HEAD }),
    versionSnapshot(),
  ]);
  await importer.commits(RUN, [commit(), commit(OTHER_HEAD)]);
  await importer.snapshotCommits(RUN, BRANCH, [HEAD, OTHER_HEAD]);
  await importer.snapshotCommits(RUN, OTHER_BRANCH, [OTHER_HEAD]);
  for (const branch of [BRANCH, OTHER_BRANCH, VERSION_BRANCH]) await importer.seal(RUN, branch);
  const result = await importer.finish(RUN, 3);
  assert.equal(result.branches, 3);
  assert.equal(result.commits, 2);
  assert.deepEqual(await importer.finish(RUN, 3), result);
  const state = fake.tables.uiComponentSyncStatus.get("singleton");
  assert.equal(state.activeRunId, RUN);
  assert.equal(state.runId, null);
  assert.equal(state.leaseUntil, null);
  assert.equal(state.lastSynced.toISOString(), result.lastSynced);
  assert.equal(fake.tables.uiComponentRefreshRun.get(RUN).status, "COMPLETED");
  assert.equal(fake.tables.uiComponentSnapshotCommit.size, 3);
});

test("failed count, missing snapshot and unsealed finishes preserve the prior active dataset", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await importer.start(RUN);
  await importer.prepare(RUN, [BRANCH, VERSION_BRANCH]);
  await importer.manifest(RUN, [snapshot()]);
  const before = fake.checkpoint();
  await rejects(() => importer.finish(RUN, 1), UiComponentImportValidationError, /declared manifest/);
  await rejects(() => importer.finish(RUN, 2), UiComponentImportValidationError, /complete and sealed/);
  assert.deepEqual(fake.tables, before);
  await importer.manifest(RUN, [versionSnapshot()]);
  await importer.commits(RUN, [commit()]);
  await importer.snapshotCommits(RUN, BRANCH, [HEAD]);
  await importer.seal(RUN, BRANCH);
  const unsealed = fake.checkpoint();
  await rejects(() => importer.finish(RUN, 2), UiComponentImportValidationError, /complete and sealed/);
  assert.deepEqual(fake.tables, unsealed);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, OLD_RUN);
});

test("finish cannot publish a zero-branch run that never declared a manifest", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await importer.start(RUN);
  const before = fake.checkpoint();
  await rejects(() => importer.finish(RUN, 0));
  assert.deepEqual(fake.tables, before);
});

test("abort is idempotent and preserves the previously active run", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await stageOne(importer);
  assert.deepEqual(await importer.abort(RUN, "Bitbucket failed"), {});
  const failed = fake.checkpoint();
  assert.deepEqual(await importer.abort(RUN, "retry abort"), {});
  assert.deepEqual(fake.tables, failed);
  assert.equal(fake.tables.uiComponentRefreshRun.get(RUN).status, "FAILED");
  assert.equal(fake.tables.uiComponentRefreshRun.get(RUN).error, "Bitbucket failed");
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, OLD_RUN);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").runId, null);
  await rejects(() => importer.start(RUN), UiComponentImportConflict, /already used/);
  await rejects(() => importer.finish(RUN, 1), UiComponentImportConflict);
});

test("expired run takeover marks the old run failed and blocks its late publication", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await stageOne(importer);
  fake.expire();
  await importer.start(OTHER_RUN);
  assert.equal(fake.tables.uiComponentRefreshRun.get(RUN).status, "FAILED");
  assert.equal(fake.tables.uiComponentRefreshRun.get(RUN).error, "Refresh lease expired");
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").runId, OTHER_RUN);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, OLD_RUN);
  const before = fake.checkpoint();
  await rejects(() => importer.finish(RUN, 1), UiComponentImportConflict);
  await rejects(() => importer.start(RUN), UiComponentImportConflict, /already used/);
  assert.deepEqual(await importer.abort(RUN, "stale abort"), {});
  assert.deepEqual(fake.tables, before);
});

test("late successful finish retries never republish an older run or alter a new lease", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  const first = await importer.finish(RUN, 1);
  await stageOne(importer, OTHER_RUN);
  const second = await importer.finish(OTHER_RUN, 1);
  const before = fake.checkpoint();
  assert.deepEqual(await importer.finish(RUN, 1), first);
  assert.deepEqual(fake.tables, before);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, OTHER_RUN);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").lastSynced.toISOString(), second.lastSynced);
  await rejects(() => importer.finish(RUN, 2), UiComponentImportValidationError, /expected branch count/);
  await rejects(() => importer.abort(RUN), UiComponentImportConflict);
  assert.deepEqual(fake.tables, before);
});

test("completed run retries remain read-only while a different run holds the lease", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  const completed = await importer.finish(RUN, 1);
  await importer.start(OTHER_RUN);
  const before = fake.checkpoint();
  assert.deepEqual(await importer.finish(RUN, 1), completed);
  assert.deepEqual(fake.tables, before);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").runId, OTHER_RUN);
});

const analysis = (commitSha = HEAD) => ({ commitSha, patchFingerprint: "v2", fingerprintStatus: "READY", fingerprintError: null });
const mainPr = (prId = 10) => ({ prId, title: "fix: main", state: "MERGED", authorName: "developer",
  fromBranch: "feature", toBranch: "main", sourceSha: HEAD, targetSha: BOUNDARY, updatedAt: "2026-01-02T00:00:00.000Z",
  commitShas: [HEAD], patchFingerprint: "v2", fingerprintStatus: "READY", fingerprintError: null });

test("main PRs and all release analyses must be present before atomic publication", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await stageOne(importer);
  await importer.prepareAnalysis(RUN, [10], [HEAD]);
  await rejects(() => importer.finish(RUN, 1), UiComponentImportValidationError, /Analysis incomplete/);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, OLD_RUN);
  await importer.mainPrs(RUN, [mainPr()]);
  await rejects(() => importer.finish(RUN, 1), UiComponentImportValidationError, /Analysis incomplete/);
  await importer.commitAnalyses(RUN, [analysis()]);
  const result = await importer.finish(RUN, 1);
  assert.equal(result.mainPrs, 1);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, RUN);
});

test("analysis manifest must exactly describe linked release commits, including shared deduplication", async () => {
  const { importer } = setup();
  await stageOne(importer);
  await importer.prepareAnalysis(RUN, [], []);
  await rejects(() => importer.finish(RUN, 1), UiComponentImportValidationError, /Analysis incomplete/);
  await rejects(() => importer.prepareAnalysis(RUN, [], [HEAD]), UiComponentImportValidationError, /cannot change/);
});

test("analysis batches are idempotent and cannot change metadata or inject a different run", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  await rejects(() => importer.mainPrs(RUN, [mainPr()]), UiComponentImportValidationError, /Prepare analysis/);
  await importer.prepareAnalysis(RUN, [10], [HEAD]);
  await importer.mainPrs(RUN, [{ ...mainPr(), runId: OTHER_RUN }]);
  await importer.commitAnalyses(RUN, [{ ...analysis(), runId: OTHER_RUN }]);
  assert.equal(fake.tables.uiComponentMainPr.get(`${RUN}:10`).runId, RUN);
  assert.equal(fake.tables.uiComponentCommitAnalysis.get(`${RUN}:${HEAD}`).runId, RUN);
  await importer.mainPrs(RUN, [mainPr()]); await importer.commitAnalyses(RUN, [analysis()]);
  await rejects(() => importer.mainPrs(RUN, [{ ...mainPr(), state: "OPEN" }]), UiComponentImportValidationError, /cannot change/);
  await rejects(() => importer.commitAnalyses(RUN, [{ ...analysis(), fingerprintStatus: "UNAVAILABLE", patchFingerprint: null, fingerprintError: "truncated" }]), UiComponentImportValidationError, /cannot change/);
  await rejects(() => importer.mainPrs(RUN, [mainPr(11)]), UiComponentImportValidationError, /not in the manifest/);
  await rejects(() => importer.commitAnalyses(RUN, [analysis(OTHER_HEAD)]), UiComponentImportValidationError, /not in the manifest/);
});

test("persisted HTTP 500 markers survive an aborted run and stay guarded by ownership", async () => {
  const { importer, fake } = setup({ oldActive: true });
  await importer.start(RUN);
  await importer.diffFailed(RUN, "pr:10");
  await importer.diffFailed(RUN, `commit:${HEAD}`);
  await rejects(() => importer.diffFailed(OTHER_RUN, "pr:11"), UiComponentImportConflict);
  await rejects(() => importer.diffFailures(OTHER_RUN, ["pr:10"]), UiComponentImportConflict);
  await importer.abort(RUN);
  await importer.start(OTHER_RUN);
  assert.deepEqual((await importer.diffFailures(OTHER_RUN, ["pr:10", "pr:11", `commit:${HEAD}`])).keys.sort(), [`commit:${HEAD}`, "pr:10"].sort());
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, OLD_RUN);
});

test("older metadata-only CLI cannot replace a dataset containing main PR analysis", async () => {
  const { importer, fake } = setup();
  await stageOne(importer);
  await importer.prepareAnalysis(RUN, [], [HEAD]);
  await importer.commitAnalyses(RUN, [analysis()]);
  await importer.finish(RUN, 1);
  await stageOne(importer, OTHER_RUN);
  await rejects(() => importer.finish(OTHER_RUN, 1), UiComponentImportValidationError, /Upgrade the CLI/);
  assert.equal(fake.tables.uiComponentSyncStatus.get("singleton").activeRunId, RUN);
});
