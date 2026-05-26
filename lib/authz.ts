import "server-only";

import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export const SUPER_ADMIN_EMAIL = "satyabrat.ojha@juspay.in";

export type AdminAccess = {
  email: string | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  canManageAdmins: boolean;
  canRemoveAdmins: boolean;
  canEditAnyPR: boolean;
};

export function normalizeEmail(value?: string | null) {
  const email = value?.trim().toLowerCase();
  return email || null;
}

export function isSuperAdminEmail(email?: string | null) {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}

export async function getCurrentUserEmail() {
  const user = await currentUser();
  return normalizeEmail(user?.primaryEmailAddress?.emailAddress);
}

export async function getAdminAccess(
  email?: string | null
): Promise<AdminAccess> {
  const normalizedEmail = normalizeEmail(email);
  const isAuthenticated = Boolean(normalizedEmail);
  const isSuperAdmin = isSuperAdminEmail(normalizedEmail);
  const isAdmin =
    isAuthenticated &&
    !isSuperAdmin &&
    (await prisma.adminUser.findUnique({
      where: { email: normalizedEmail! },
      select: { email: true },
    })) !== null;
  const canManageAdmins = isSuperAdmin || isAdmin;

  return {
    email: normalizedEmail,
    isAuthenticated,
    isSuperAdmin,
    isAdmin,
    canManageAdmins,
    canRemoveAdmins: isSuperAdmin,
    canEditAnyPR: canManageAdmins,
  };
}

export async function canEditReleasePR(
  userEmail: string | null | undefined,
  authorEmail: string | null | undefined
) {
  const normalizedUserEmail = normalizeEmail(userEmail);

  if (!normalizedUserEmail) {
    return false;
  }

  if (isSuperAdminEmail(normalizedUserEmail)) {
    return true;
  }

  if (normalizedUserEmail === normalizeEmail(authorEmail)) {
    return true;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { email: normalizedUserEmail },
    select: { email: true },
  });

  return admin !== null;
}
