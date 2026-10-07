import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readUiComponentDashboard } from "@/lib/ui-component-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await readUiComponentDashboard(prisma), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2021" || code === "P2022") return NextResponse.json({ success: false, error: "UI Components schema is not ready. Apply the database migrations before refreshing." }, { status: 503 });
    console.error("[ui-components] Read failed:", error);
    return NextResponse.json({ success: false, error: "Could not load UI Components. Check database connectivity and try again." }, { status: 500 });
  }
}
