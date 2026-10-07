import type { Prisma, PrismaClient, UiComponentRefreshRun } from "@prisma/client";
import {
  UiComponentImportValidationError,
  validateBranch,
  validateBranchManifest,
  validateCommitRecords,
  validateCommitShas,
  validateExpectedBranches,
  validateRunId,
  validateSnapshotRecords,
  type ImportedUiComponentCommit,
  type ImportedUiComponentSnapshot,
} from "./ui-component-import-validation";

const LEASE_MS = 5 * 60 * 1000;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
type Tx = Prisma.TransactionClient;

export class UiComponentImportConflict extends Error {}

// Dependency injection keeps lease/publication tests completely offline.
export function createUiComponentImporter(db: PrismaClient) {
  async function claimOwnedLease(tx: Tx, runId: string) {
    const now = new Date();
    const claimed = await tx.uiComponentSyncStatus.updateMany({
      where: { id: "singleton", runId, leaseUntil: { gt: now } },
      data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count !== 1) throw new UiComponentImportConflict("UI Components lease expired or belongs to another run");
    const run = await tx.uiComponentRefreshRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "RUNNING") throw new UiComponentImportConflict("UI Components run is not running");
    return run;
  }

  async function owned<T>(runId: string, action: (tx: Tx, run: UiComponentRefreshRun) => Promise<T>) {
    validateRunId(runId);
    return db.$transaction(async (tx) => {
      // Guard and writes share a transaction: this UPDATE holds the singleton
      // row lock until commit, serializing publication, abort and lease claims.
      const run = await claimOwnedLease(tx, runId);
      return action(tx, run);
    }, TRANSACTION_OPTIONS);
  }

  async function snapshotFor(tx: Tx, runId: string, branch: string) {
    const snapshot = await tx.uiComponentReleaseSnapshot.findUnique({ where: { runId_branch: { runId, branch } } });
    if (!snapshot) throw new UiComponentImportValidationError("Invalid snapshot: branch has not been staged");
    return snapshot;
  }

  return {
    async start(runId: string) {
      validateRunId(runId);
      return db.$transaction(async (tx) => {
        const state = await tx.uiComponentSyncStatus.upsert({
          where: { id: "singleton" }, create: { id: "singleton" }, update: {},
        });
        const now = new Date();
        if (state.runId === runId && state.leaseUntil && state.leaseUntil > now) {
          const run = await claimOwnedLease(tx, runId);
          return { startedAt: run.startedAt.toISOString() };
        }
        const previousRun = await tx.uiComponentRefreshRun.findUnique({ where: { id: runId } });
        if (previousRun) throw new UiComponentImportConflict("Run ID was already used; start a new UI Components refresh");
        const claimed = await tx.uiComponentSyncStatus.updateMany({
          where: {
            id: "singleton",
            OR: [{ runId: null }, { leaseUntil: null }, { leaseUntil: { lte: now } }],
          },
          data: { runId, leaseUntil: new Date(now.getTime() + LEASE_MS) },
        });
        if (claimed.count !== 1) throw new UiComponentImportConflict("Another UI Components refresh is running");
        if (state.runId) {
          await tx.uiComponentRefreshRun.updateMany({
            where: { id: state.runId, status: "RUNNING" },
            data: { status: "FAILED", finishedAt: now, error: "Refresh lease expired" },
          });
        }
        await tx.uiComponentRefreshRun.create({ data: { id: runId, startedAt: now } });
        return { startedAt: now.toISOString() };
      }, TRANSACTION_OPTIONS);
    },

    async heartbeat(runId: string) {
      return owned(runId, async () => ({}));
    },

    async prepare(runId: string, branches: unknown) {
      validateBranchManifest(branches);
      const manifest = [...branches].sort();
      return owned(runId, async (tx, run) => {
        if (run.branchManifest.length && !equal(run.branchManifest, manifest)) {
          throw new UiComponentImportValidationError("Invalid branch manifest: it cannot change within a run");
        }
        await tx.uiComponentRefreshRun.update({ where: { id: runId }, data: { branchManifest: manifest } });
        return { expectedBranches: manifest.length };
      });
    },

    async manifest(runId: string, records: unknown) {
      validateSnapshotRecords(records);
      return owned(runId, async (tx, run) => {
        if (!run.branchManifest.length) throw new UiComponentImportValidationError("Invalid run: prepare the branch manifest first");
        for (const record of records) {
          if (!run.branchManifest.includes(record.branch)) throw new UiComponentImportValidationError("Invalid snapshot: branch is not in the declared manifest");
          const data = snapshotData(record);
          const stored = await tx.uiComponentReleaseSnapshot.upsert({
            where: { runId_branch: { runId, branch: record.branch } },
            create: { id: `${runId}:${record.branch}`, runId, ...data },
            update: {},
          });
          if (!equal(pick(stored, Object.keys(data)), data)) {
            throw new UiComponentImportValidationError("Invalid snapshot: metadata cannot change within a run");
          }
        }
        return { processed: records.length };
      });
    },

    async commits(runId: string, records: unknown) {
      validateCommitRecords(records);
      return owned(runId, async (tx) => {
        for (const record of records) {
          const data = commitData(record);
          const stored = await tx.uiComponentReleaseCommit.upsert({
            where: { sha: record.sha }, create: data, update: {},
          });
          if (!equal(pick(stored, Object.keys(data)), data)) {
            throw new UiComponentImportValidationError(`Invalid commit: immutable metadata conflicts for ${record.sha}`);
          }
        }
        return { processed: records.length };
      });
    },

    async snapshotCommits(runId: string, branch: unknown, commitShas: unknown) {
      validateBranch(branch);
      validateCommitShas(commitShas);
      return owned(runId, async (tx) => {
        const snapshot = await snapshotFor(tx, runId, branch);
        if (snapshot.status === "published-version" || commitShas.includes(snapshot.jenkinsBoundarySha || "")) {
          throw new UiComponentImportValidationError("Invalid snapshot commits: version or Jenkins boundary cannot have release links");
        }
        const existing = await tx.uiComponentSnapshotCommit.findMany({ where: { snapshotId: snapshot.id }, select: { commitSha: true } });
        const linked = new Set(existing.map((row) => row.commitSha));
        const additions = commitShas.filter((sha) => !linked.has(sha));
        if (snapshot.sealed && additions.length) throw new UiComponentImportValidationError("Invalid snapshot: sealed links cannot change");
        if (linked.size + additions.length > snapshot.expectedCommitCount) throw new UiComponentImportValidationError("Invalid snapshot: too many release commits");
        const found = await tx.uiComponentReleaseCommit.count({ where: { sha: { in: commitShas } } });
        if (found !== commitShas.length) throw new UiComponentImportValidationError("Invalid snapshot commits: upload commit metadata first");
        await tx.uiComponentSnapshotCommit.createMany({
          data: additions.map((commitSha) => ({ snapshotId: snapshot.id, commitSha })), skipDuplicates: true,
        });
        return { processed: commitShas.length };
      });
    },

    async seal(runId: string, branch: unknown) {
      validateBranch(branch);
      return owned(runId, async (tx) => {
        const snapshot = await snapshotFor(tx, runId, branch);
        const count = await tx.uiComponentSnapshotCommit.count({ where: { snapshotId: snapshot.id } });
        if (count !== snapshot.expectedCommitCount) throw new UiComponentImportValidationError("Invalid snapshot: release commit count is incomplete");
        if (count > 0) {
          const head = await tx.uiComponentSnapshotCommit.findUnique({
            where: { snapshotId_commitSha: { snapshotId: snapshot.id, commitSha: snapshot.uiComponentsHeadSha } },
          });
          if (!head) throw new UiComponentImportValidationError("Invalid snapshot: pinned head is missing from release commits");
        }
        await tx.uiComponentReleaseSnapshot.update({ where: { id: snapshot.id }, data: { sealed: true } });
        return { branch, commits: count };
      });
    },

    async finish(runId: string, expectedBranches: unknown) {
      validateRunId(runId);
      validateExpectedBranches(expectedBranches);
      return db.$transaction(async (tx) => {
        const state = await tx.uiComponentSyncStatus.findUnique({ where: { id: "singleton" } });
        const previous = await tx.uiComponentRefreshRun.findUnique({ where: { id: runId } });
        // A retried successful request is read-only. Never republish an older
        // completed run, including after another run became active.
        if (previous?.status === "COMPLETED") {
          if (previous.branchCount !== expectedBranches) throw new UiComponentImportValidationError("Invalid expected branch count");
          return finishedResult(previous);
        }
        const run = await claimOwnedLease(tx, runId);
        if (!state || !run.branchManifest.length || run.branchManifest.length !== expectedBranches) {
          throw new UiComponentImportValidationError("Invalid expected branch count: it must match the declared manifest");
        }
        const snapshots = await tx.uiComponentReleaseSnapshot.findMany({ where: { runId }, include: { _count: { select: { commits: true } } } });
        if (snapshots.length !== expectedBranches || snapshots.some((snapshot) =>
          !snapshot.sealed || snapshot._count.commits !== snapshot.expectedCommitCount || !run.branchManifest.includes(snapshot.branch))) {
          throw new UiComponentImportValidationError("Invalid run: every declared snapshot must be complete and sealed");
        }
        const commits = await tx.uiComponentReleaseCommit.count({ where: { snapshots: { some: { snapshot: { runId } } } } });
        const finishedAt = new Date();
        const completed = await tx.uiComponentRefreshRun.update({
          where: { id: runId }, data: { status: "COMPLETED", finishedAt, branchCount: snapshots.length, commitCount: commits },
        });
        await tx.uiComponentSyncStatus.update({
          where: { id: "singleton" }, data: { runId: null, leaseUntil: null, activeRunId: runId, lastSynced: finishedAt },
        });
        return finishedResult(completed);
      }, TRANSACTION_OPTIONS);
    },

    async abort(runId: string, error: unknown = "Refresh aborted") {
      validateRunId(runId);
      if (typeof error !== "string" || error.length > 2000 || error.includes("\0")) throw new UiComponentImportValidationError("Invalid abort error");
      return db.$transaction(async (tx) => {
        const previous = await tx.uiComponentRefreshRun.findUnique({ where: { id: runId } });
        if (previous?.status === "FAILED") return {};
        await claimOwnedLease(tx, runId);
        await tx.uiComponentRefreshRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), error } });
        await tx.uiComponentSyncStatus.update({ where: { id: "singleton" }, data: { runId: null, leaseUntil: null } });
        return {};
      }, TRANSACTION_OPTIONS);
    },
  };
}

function snapshotData(record: ImportedUiComponentSnapshot) {
  return {
    branch: record.branch, widgetHeadSha: record.widgetHeadSha,
    uiComponentsRef: record.uiComponentsRef, uiComponentsRefType: record.uiComponentsRefType,
    uiComponentsHeadSha: record.uiComponentsHeadSha, uiComponentsBranches: [...record.uiComponentsBranches].sort(),
    jenkinsBoundarySha: record.jenkinsBoundarySha, status: record.status,
    warnings: record.warnings, expectedCommitCount: record.expectedCommitCount,
  };
}

function commitData(record: ImportedUiComponentCommit) {
  return {
    sha: record.sha, displayId: record.sha.slice(0, 12),
    authorName: record.author.name, authorEmail: record.author.emailAddress,
    authorTimestamp: record.authorTimestamp === null ? null : new Date(record.authorTimestamp),
    message: record.message, parents: record.parents,
  };
}

function finishedResult(run: UiComponentRefreshRun) {
  return { lastSynced: run.finishedAt!.toISOString(), branches: run.branchCount, commits: run.commitCount };
}

function equal(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function pick(record: object, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, (record as Record<string, unknown>)[key]]));
}
