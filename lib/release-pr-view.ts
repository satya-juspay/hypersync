import "server-only";

import { DEFAULT_REPO, prUrl } from "@/lib/bitbucket";
import type { ReleasePR, ReleasePRStatus } from "@/types/hypersync";

export const releasePrPublicSelect = {
  id: true,
  title: true,
  author: true,
  authorEmail: true,
  displayName: true,
  releaseBranch: true,
  mainPrId: true,
  updatedStatus: true,
  updatedBy: true,
  updatedAt: true,
  mergedAt: true,
  createdAt: true,
} as const;

export type ReleasePrPublicRecord = {
  id: string;
  title: string;
  author: string;
  authorEmail: string | null;
  displayName: string;
  releaseBranch: string;
  mainPrId: string | null;
  updatedStatus: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  mergedAt: Date | null;
  createdAt: Date;
};

export function deriveReleasePrStatus(
  releasePR: Pick<ReleasePrPublicRecord, "mainPrId" | "updatedStatus">,
  mainPrStatus?: string | null
): ReleasePRStatus {
  if (releasePR.updatedStatus === "APPROVED") return "APPROVED";
  if (!releasePR.mainPrId) return "MISSING";
  if (mainPrStatus === "MERGED") return "MERGED";
  if (mainPrStatus === "OPEN") return "OPEN";
  if (mainPrStatus === "DECLINED") return "DECLINED";
  return "INVALID";
}

export function toReleasePrView(
  releasePR: ReleasePrPublicRecord,
  mainPrStatus?: string | null
): ReleasePR {
  return {
    id: releasePR.id,
    title: releasePR.title,
    author: releasePR.author,
    authorEmail: releasePR.authorEmail,
    displayName: releasePR.displayName,
    releaseBranch: releasePR.releaseBranch,
    mainPrId: releasePR.mainPrId,
    updatedStatus: releasePR.updatedStatus,
    syncStatus: deriveReleasePrStatus(releasePR, mainPrStatus),
    mergedAt: releasePR.mergedAt?.toISOString() ?? null,
    updatedBy: releasePR.updatedBy,
    updatedAt: releasePR.updatedAt?.toISOString() ?? null,
    createdAt: releasePR.createdAt.toISOString(),
    bitbucketUrl: prUrl(DEFAULT_REPO, releasePR.id),
  };
}
