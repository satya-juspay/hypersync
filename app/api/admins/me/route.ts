import { NextResponse } from "next/server";
import { getAdminAccess, getCurrentUserEmail } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET() {
  const userEmail = await getCurrentUserEmail();
  const access = await getAdminAccess(userEmail);

  return NextResponse.json({ success: true, access });
}
