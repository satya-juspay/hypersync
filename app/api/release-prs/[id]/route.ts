import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { resolveMainPrStatus } from "@/lib/bitbucket";

const VALID_STATUSES = ["SYNCED", "MAIN_PR_OPEN", "MISSING_MAIN_PR"];
const REPO = "hyper-widget";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const pr = await prisma.releasePR.findUnique({ where: { id } });

    if (!pr) {
      return NextResponse.json(
        { success: false, error: "PR not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: pr });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch PR" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;

  let body: { syncStatus?: string; mainPrId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { syncStatus, mainPrId } = body;

  if (syncStatus !== undefined && !VALID_STATUSES.includes(syncStatus)) {
    return NextResponse.json(
      { success: false, error: `syncStatus must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const existing = await prisma.releasePR.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "PR not found" },
        { status: 404 }
      );
    }

    // Determine effective mainPrId (request takes priority over stored value)
    const effectiveMainPrId = (
      mainPrId !== undefined ? mainPrId : existing.mainPrId
    )?.trim() || null;

    // If a mainPrId is available, always derive syncStatus from Bitbucket
    let resolvedStatus = syncStatus;
    if (effectiveMainPrId) {
      try {
        resolvedStatus = await resolveMainPrStatus(REPO, Number(effectiveMainPrId));
      } catch {
        // Bitbucket unreachable — fall back to request value or existing status
        resolvedStatus = syncStatus ?? existing.syncStatus;
      }
    } else if (resolvedStatus === undefined) {
      // No mainPrId and no explicit status → mark missing
      resolvedStatus = "MISSING_MAIN_PR";
    }

    const updated = await prisma.releasePR.update({
      where: { id },
      data: {
        ...(resolvedStatus !== undefined && { syncStatus: resolvedStatus }),
        ...(mainPrId !== undefined && { mainPrId: mainPrId || null }),
      },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      ...(resolvedStatus !== syncStatus && syncStatus !== undefined && {
        overridden: true,
        overrideReason:
          resolvedStatus === "SYNCED"
            ? "Main PR is already merged — status set to SYNCED"
            : resolvedStatus === "MAIN_PR_OPEN"
            ? "Main PR is still open — status set to MAIN_PR_OPEN"
            : "No main PR found — status set to MISSING_MAIN_PR",
      }),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Failed to update PR" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const existing = await prisma.releasePR.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "PR not found" },
        { status: 404 }
      );
    }

    await prisma.releasePR.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Failed to delete PR" },
      { status: 500 }
    );
  }
}
