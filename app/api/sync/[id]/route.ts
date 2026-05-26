import { NextRequest, NextResponse } from "next/server";
import { canEditReleasePR, getCurrentUserEmail } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userEmail = await getCurrentUserEmail();

  if (!userEmail) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  // Accept string (set), null (clear), or omit (leave unchanged)
  const updatedStatus: string | null | undefined =
    body?.updatedStatus === null
      ? null
      : typeof body?.updatedStatus === "string"
        ? body.updatedStatus.trim() || null
        : undefined;

  if (
    updatedStatus !== undefined &&
    updatedStatus !== null &&
    updatedStatus !== "APPROVED"
  ) {
    return NextResponse.json(
      { success: false, error: "updatedStatus must be APPROVED or null" },
      { status: 400 }
    );
  }

  const mainPrId: string | null | undefined =
    body?.mainPrId === null
      ? null
      : typeof body?.mainPrId === "string"
        ? body.mainPrId.trim() || null
        : undefined;

  if (updatedStatus === undefined && mainPrId === undefined) {
    return NextResponse.json(
      { success: false, error: "At least one of updatedStatus or mainPrId is required" },
      { status: 400 }
    );
  }

  const existing = await prisma.releasePR.findUnique({ where: { id } });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: `Release PR #${id} not found` },
      { status: 404 }
    );
  }

  if (!(await canEditReleasePR(userEmail, existing.author))) {
    return NextResponse.json(
      { success: false, error: "You are not allowed to edit this PR" },
      { status: 403 }
    );
  }

  const updated = await prisma.releasePR.update({
    where: { id },
    data: {
      ...(updatedStatus !== undefined && { updatedStatus }),
      ...(mainPrId !== undefined && { mainPrId }),
      updatedBy: userEmail,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ success: true, data: updated });
}
