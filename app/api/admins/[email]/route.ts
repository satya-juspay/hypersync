import { NextResponse } from "next/server";
import {
  getAdminAccess,
  getCurrentUserEmail,
  normalizeEmail,
  SUPER_ADMIN_EMAIL,
} from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ email: string }> }
) {
  const userEmail = await getCurrentUserEmail();
  const access = await getAdminAccess(userEmail);

  if (!access.isAuthenticated) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  if (!access.canRemoveAdmins) {
    return NextResponse.json(
      { success: false, error: "Only the super admin can remove admins" },
      { status: 403 }
    );
  }

  const { email: emailParam } = await params;
  const email = normalizeEmail(decodeEmailParam(emailParam));

  if (!email) {
    return NextResponse.json(
      { success: false, error: "Valid email is required" },
      { status: 400 }
    );
  }

  if (email === SUPER_ADMIN_EMAIL) {
    return NextResponse.json(
      { success: false, error: "Super admin cannot be removed" },
      { status: 400 }
    );
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Admin not found" },
      { status: 404 }
    );
  }

  await prisma.adminUser.delete({ where: { email } });

  return NextResponse.json({ success: true });
}

function decodeEmailParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
