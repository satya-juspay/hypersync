import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const data = await prisma.releasePR.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        author: true,
        releaseBranch: true,
        mainPrId: true,
        syncStatus: true,
        createdAt: true,
        mergedAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, count: data.length, data });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch release PRs" },
      { status: 500 }
    );
  }
}
