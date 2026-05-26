import { NextResponse } from "next/server";
import {
  getAdminAccess,
  getCurrentUserEmail,
  normalizeEmail,
  SUPER_ADMIN_EMAIL,
} from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const userEmail = await getCurrentUserEmail();
  const access = await getAdminAccess(userEmail);

  if (!access.isAuthenticated) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!access.canManageAdmins) {
    return NextResponse.json(
      { success: false, error: "Admin access required" },
      { status: 403 }
    );
  }

  const admins = await prisma.adminUser.findMany({
    orderBy: { email: "asc" },
  });

  return NextResponse.json({
    success: true,
    superAdmin: { email: SUPER_ADMIN_EMAIL },
    admins,
    access,
  });
}

export async function POST(request: Request) {
  const userEmail = await getCurrentUserEmail();
  const access = await getAdminAccess(userEmail);

  if (!access.isAuthenticated) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!access.canManageAdmins) {
    return NextResponse.json(
      { success: false, error: "Admin access required" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body?.email);

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { success: false, error: "Valid email is required" },
      { status: 400 }
    );
  }

  if (email === SUPER_ADMIN_EMAIL) {
    return NextResponse.json(
      { success: false, error: "Super admin is built in" },
      { status: 400 }
    );
  }

  const admin = await prisma.adminUser.upsert({
    where: { email },
    create: { email, createdBy: userEmail },
    update: {},
  });

  return NextResponse.json({ success: true, data: admin });
}
