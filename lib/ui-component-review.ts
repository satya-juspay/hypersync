import type {
  UiComponentMainPrInput, UiComponentMatch, UiComponentMatchStatus,
  UiComponentReview, UiComponentReviewAccess, UiComponentReviewRequest,
} from "./ui-component-types";

export class UiComponentReviewError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
  }
}

export function parseUiComponentReviewRequest(value: unknown): UiComponentReviewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UiComponentReviewError("Expected a review object");
  const body = value as Record<string, unknown>;
  if (typeof body.runId !== "string" || !body.runId.trim() || body.runId.length > 100) throw new UiComponentReviewError("A refresh run ID is required");
  if (typeof body.action !== "string" || !["confirm", "approve", "unapprove", "clear-match"].includes(body.action)) throw new UiComponentReviewError("Unknown review action");
  const allowed = body.action === "confirm" ? ["runId", "action", "mainPrId"] : ["runId", "action"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new UiComponentReviewError("Unexpected review fields");
  if (body.action === "confirm") {
    if (typeof body.mainPrId !== "number" || !Number.isSafeInteger(body.mainPrId) || body.mainPrId < 1 || body.mainPrId > 2_147_483_647) {
      throw new UiComponentReviewError("Main PR ID must be a positive integer");
    }
    return { runId: body.runId, action: "confirm", mainPrId: body.mainPrId };
  }
  return { runId: body.runId, action: body.action as "approve" | "unapprove" | "clear-match" };
}

export function canReviewUiComponentCommit(access: UiComponentReviewAccess | null, authorEmail: string | null) {
  if (!access?.isAuthenticated || !access.email) return false;
  return access.canEditAnyPR || (!!authorEmail && access.email.trim().toLowerCase() === authorEmail.trim().toLowerCase());
}

type AutomaticMatch = { matchStatus: UiComponentMatchStatus; matches: UiComponentMatch[] };
type StoredReview = Omit<UiComponentReview, "updatedAt"> & { confirmedSourceSha: string | null; updatedAt: Date };

export function applyUiComponentReview(automatic: AutomaticMatch, review: StoredReview | undefined, mainPrs: UiComponentMainPrInput[]) {
  let matchStatus = automatic.matchStatus;
  let matches = automatic.matches;
  let reviewWarning: string | null = null;
  if (review?.mainPrId) {
    const pr = mainPrs.find((item) => item.prId === review.mainPrId);
    if (!pr) {
      matchStatus = "NEEDS_REVIEW";
      reviewWarning = `Confirmed main PR #${review.mainPrId} is not in the latest imported dataset. Refresh or clear the link.`;
    } else if (pr.sourceSha !== review.confirmedSourceSha) {
      matchStatus = "NEEDS_REVIEW";
      reviewWarning = `Main PR #${pr.prId} has changed since confirmation. Review and confirm it again.`;
    } else {
      matchStatus = pr.state === "MERGED" ? "MERGED" : pr.state === "OPEN" ? "OPEN_PR" : "NEEDS_REVIEW";
      if (pr.state === "DECLINED") reviewWarning = `Confirmed main PR #${pr.prId} was declined. Select another PR or approve the commit manually.`;
      const previous = matches.find((match) => match.prId === pr.prId);
      const confirmed: UiComponentMatch = { prId: pr.prId, title: pr.title, state: pr.state, reason: "manual-confirmation", score: previous?.score ?? null,
        matchedFiles: previous?.matchedFiles ?? 0, totalFiles: previous?.totalFiles ?? 0,
        matchedAddedLines: previous?.matchedAddedLines ?? 0, totalAddedLines: previous?.totalAddedLines ?? 0,
        matchedRemovedLines: previous?.matchedRemovedLines ?? 0, totalRemovedLines: previous?.totalRemovedLines ?? 0 };
      matches = [confirmed, ...matches.filter((match) => match.prId !== pr.prId)];
    }
  }
  if (review?.approved) matchStatus = "APPROVED";
  return { matchStatus, matches, reviewWarning, review: review ? {
    mainPrId: review.mainPrId, approved: review.approved, updatedBy: review.updatedBy, updatedAt: review.updatedAt.toISOString(),
  } : null };
}
