import "server-only";

import { prisma } from "@/lib/prisma";

const FIRST_SYNC = new Date("2026-01-01T00:00:00.000Z");
const LEASE_MS = 5 * 60 * 1000;
const MAX_BATCH = 25;
const MAX_FINGERPRINT = 750_000;

export type ImportedPR = {
  id: string;
  kind: "release" | "main";
  title: string;
  author: string;
  displayName: string;
  sourceBranch: string | null;
  mergedAt: string | null;
  patchFingerprint?: string | null;
  releaseBranch?: string;
  mainPrId?: string | null;
  status?: string;
};

export class ImportConflict extends Error {}

function leaseUntil() {
  return new Date(Date.now() + LEASE_MS);
}

export async function startImport(runId: string) {
  if (!isRunId(runId)) throw new Error("Invalid run ID");
  const now = new Date();
  const existing = await prisma.syncStatus.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });

  if (existing.isRunning && existing.runId === runId && existing.leaseUntil && existing.leaseUntil > now) {
    await renewImport(runId);
    return {
      since: (existing.lastSynced ?? FIRST_SYNC).toISOString(),
      startedAt: existing.runStartedAt!.toISOString(),
      fingerprintFailures: await getFingerprintFailures(),
    };
  }

  const claimed = await prisma.syncStatus.updateMany({
    where: {
      id: "singleton",
      OR: [
        { isRunning: false },
        { leaseUntil: null },
        { leaseUntil: { lt: now } },
      ],
    },
    data: {
      isRunning: true,
      runId,
      runStartedAt: now,
      leaseUntil: leaseUntil(),
    },
  });
  if (claimed.count !== 1) throw new ImportConflict("Another import is running");
  return {
    since: (existing.lastSynced ?? FIRST_SYNC).toISOString(),
    startedAt: now.toISOString(),
    fingerprintFailures: await getFingerprintFailures(),
  };
}

export async function renewImport(runId: string) {
  const claimed = await prisma.syncStatus.updateMany({
    where: { id: "singleton", isRunning: true, runId, leaseUntil: { gt: new Date() } },
    data: { leaseUntil: leaseUntil() },
  });
  if (claimed.count !== 1) throw new ImportConflict("Import lease expired or belongs to another run");
}

export async function importBatch(runId: string, records: ImportedPR[]) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_BATCH) {
    throw new Error(`Batch must contain 1 to ${MAX_BATCH} records`);
  }
  records.forEach(validateRecord);
  await renewImport(runId);

  await prisma.$transaction(async (tx) => {
    for (const record of records) {
      const mergedAt = record.mergedAt ? new Date(record.mergedAt) : null;
      const fingerprint = record.patchFingerprint ?? undefined;
      if (record.kind === "release") {
        const data = {
          title: record.title,
          author: record.author,
          authorEmail: record.author || null,
          displayName: record.displayName,
          ...(record.sourceBranch && { sourceBranch: record.sourceBranch }),
          releaseBranch: record.releaseBranch!,
          ...(fingerprint !== undefined && {
            patchFingerprint: fingerprint,
            patchFingerprintError: null,
          }),
          mergedAt,
        };
        await tx.releasePR.upsert({
          where: { id: record.id },
          create: { id: record.id, ...data, mainPrId: record.mainPrId ?? null },
          update: data,
        });
        // Preserve a concurrent user's explicit link or unlink.
        await tx.releasePR.updateMany({
          where: { id: record.id, updatedBy: null },
          data: { mainPrId: record.mainPrId ?? null },
        });
      } else {
        const data = {
          title: record.title,
          author: record.author,
          displayName: record.displayName,
          ...(record.sourceBranch && { sourceBranch: record.sourceBranch }),
          status: record.status!,
          ...(fingerprint !== undefined && {
            patchFingerprint: fingerprint,
            patchFingerprintError: null,
          }),
          mergedAt,
        };
        await tx.mainPR.upsert({
          where: { id: record.id },
          create: { id: record.id, ...data },
          update: data,
        });
      }
    }
  }, { timeout: 30_000 });
  return { processed: records.length };
}

export async function pendingFingerprints(
  runId: string,
  limit: number,
  kind?: "release" | "main",
  excludeIds: string[] = []
) {
  await renewImport(runId);
  const take = Math.min(Math.max(limit, 0), 50);
  const where = {
    patchFingerprint: null,
    patchFingerprintError: null,
    ...(excludeIds.length > 0 && { id: { notIn: excludeIds } }),
  };

  if (kind === "release") {
    const release = await prisma.releasePR.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take,
    });
    return release.map(({ id }) => ({ id, kind: "release" as const }));
  }

  if (kind === "main") {
    const main = await prisma.mainPR.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take,
    });
    return main.map(({ id }) => ({ id, kind: "main" as const }));
  }

  const [release, main] = await Promise.all([
    prisma.releasePR.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take }),
    prisma.mainPR.findMany({ where, select: { id: true }, orderBy: { createdAt: "desc" }, take }),
  ]);
  const records: Array<{ id: string; kind: "release" | "main" }> = [];
  for (let index = 0; records.length < take && index < take; index++) {
    if (release[index]) records.push({ id: release[index].id, kind: "release" });
    if (main[index] && records.length < take) records.push({ id: main[index].id, kind: "main" });
  }
  return records;
}

export async function markFingerprintFailed(
  runId: string,
  kind: "release" | "main",
  id: string
) {
  if (!/^[0-9]+$/.test(id)) throw new Error("Invalid fingerprint PR ID");
  await renewImport(runId);

  const result = kind === "release"
    ? await prisma.releasePR.updateMany({
        where: { id },
        data: {
          patchFingerprint: null,
          patchFingerprintError: "BITBUCKET_HTTP_500",
        },
      })
    : await prisma.mainPR.updateMany({
        where: { id },
        data: {
          patchFingerprint: null,
          patchFingerprintError: "BITBUCKET_HTTP_500",
        },
      });

  if (result.count !== 1) throw new Error("Invalid fingerprint PR target");
}

async function getFingerprintFailures() {
  const [release, main] = await Promise.all([
    prisma.releasePR.findMany({
      where: { patchFingerprintError: { not: null } },
      select: { id: true },
    }),
    prisma.mainPR.findMany({
      where: { patchFingerprintError: { not: null } },
      select: { id: true },
    }),
  ]);

  return {
    release: release.map(({ id }) => id),
    main: main.map(({ id }) => id),
  };
}

export async function finishImport(runId: string) {
  const status = await prisma.syncStatus.findUnique({ where: { id: "singleton" } });
  if (!status?.runStartedAt) throw new ImportConflict("Import run is missing");
  const finished = await prisma.syncStatus.updateMany({
    where: { id: "singleton", isRunning: true, runId, leaseUntil: { gt: new Date() } },
    data: {
      isRunning: false,
      runId: null,
      runStartedAt: null,
      leaseUntil: null,
      lastSynced: status.runStartedAt,
    },
  });
  if (finished.count !== 1) throw new ImportConflict("Import lease expired or belongs to another run");
  return { lastSynced: status.runStartedAt.toISOString() };
}

export async function abortImport(runId: string) {
  await releaseImport(runId);
}

export async function releaseImport(runId: string) {
  const aborted = await prisma.syncStatus.updateMany({
    where: { id: "singleton", isRunning: true, runId, leaseUntil: { gt: new Date() } },
    data: { isRunning: false, runId: null, runStartedAt: null, leaseUntil: null },
  });
  if (aborted.count !== 1) throw new ImportConflict("Import lease expired or belongs to another run");
}

function isRunId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function validateRecord(value: ImportedPR) {
  if (!value || !/^[0-9]+$/.test(value.id) || !["release", "main"].includes(value.kind)) {
    throw new Error("Invalid PR ID or kind");
  }
  for (const field of ["title", "author", "displayName"] as const) {
    if (typeof value[field] !== "string" || value[field].length > 5000) throw new Error(`Invalid ${field}`);
  }
  if (value.sourceBranch !== null && (typeof value.sourceBranch !== "string" || value.sourceBranch.length > 500)) throw new Error("Invalid sourceBranch");
  if (value.mergedAt !== null && (typeof value.mergedAt !== "string" || Number.isNaN(Date.parse(value.mergedAt)))) throw new Error("Invalid mergedAt");
  if (value.patchFingerprint != null && (typeof value.patchFingerprint !== "string" || value.patchFingerprint.length > MAX_FINGERPRINT)) throw new Error("Invalid patchFingerprint");
  if (value.kind === "release" && (typeof value.releaseBranch !== "string" || value.releaseBranch.length > 500)) throw new Error("Invalid releaseBranch");
  if (value.kind === "main" && (typeof value.status !== "string" || !["OPEN", "MERGED", "DECLINED"].includes(value.status))) throw new Error("Invalid main PR status");
  if (value.mainPrId != null && !/^[0-9]+$/.test(value.mainPrId)) throw new Error("Invalid mainPrId");
}
