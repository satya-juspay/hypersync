import { NextRequest, NextResponse } from "next/server";
import { canEditReleasePR, getCurrentUserEmail } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { parseUiComponentReviewRequest, UiComponentReviewError } from "@/lib/ui-component-review";
import { saveUiComponentReview } from "@/lib/ui-component-review-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sha: string }> }) {
  try {
    const userEmail = await getCurrentUserEmail();
    if (!userEmail) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    const { sha } = await params;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) throw new UiComponentReviewError("Invalid commit SHA");
    const commitSha = sha.toLowerCase();
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ success: false, error: "Content-Type must be application/json" }, { status: 415 });
    }
    if (Number(request.headers.get("content-length")) > 4096) return NextResponse.json({ success: false, error: "Review request is too large" }, { status: 413 });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4096) return NextResponse.json({ success: false, error: "Review request is too large" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new UiComponentReviewError("Invalid JSON"); }
    const reviewRequest = parseUiComponentReviewRequest(body);
    const commit = await prisma.uiComponentReleaseCommit.findUnique({ where: { sha: commitSha }, select: { authorEmail: true } });
    if (!commit) return NextResponse.json({ success: false, error: "Release commit not found" }, { status: 404 });
    if (!(await canEditReleasePR(userEmail, commit.authorEmail))) {
      return NextResponse.json({ success: false, error: "Only the commit author or an admin can review this commit" }, { status: 403 });
    }
    const review = await saveUiComponentReview(prisma, commitSha, reviewRequest, userEmail);
    return NextResponse.json({ success: true, review }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UiComponentReviewError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    const code = (error as { code?: string }).code;
    if (code === "P2021" || code === "P2022") return NextResponse.json({ success: false, error: "UI Components reviews are not ready. Apply the latest database migrations." }, { status: 503 });
    if (code === "P2034") return NextResponse.json({ success: false, error: "Another review changed this commit. Reload and try again." }, { status: 409 });
    console.error("[ui-components] Review failed:", error);
    return NextResponse.json({ success: false, error: "Could not save the review. Try again." }, { status: 500 });
  }
}
