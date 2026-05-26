"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { RefreshCw, ArrowLeft, ShieldCheck } from "lucide-react";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";

const adminAccessCache = new Map<string, boolean>();

interface NavbarProps {
  backHref?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastSyncedAt?: string | null;
}

export function Navbar({
  backHref,
  onRefresh,
  refreshing,
  lastSyncedAt,
}: NavbarProps) {
  const { isSignedIn, isLoaded, userId } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-blue-100 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="rounded-lg border border-blue-100 bg-white p-1.5 text-blue-400 shadow-sm transition hover:bg-blue-50 hover:text-blue-600"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt="HyperSync logo"
              width={64}
              height={43}
              className="h-8 w-auto"
              priority
            />
            <span className="text-lg font-bold tracking-tight text-blue-900">
              hyperSync
            </span>
          </Link>
          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
            Beta
          </span>
        </div>

        <div className="flex items-center gap-3">
          {isLoaded && isSignedIn && (
            <AdminNavLink userId={userId ?? "signed-in"} />
          )}
          <span className="text-xs font-medium text-blue-500">
            Last sync:{" "}
            <span className="text-blue-800">{formatLastSyncedAt(lastSyncedAt)}</span>
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh data"
              className="rounded-lg border border-blue-100 bg-white p-1.5 text-blue-400 shadow-sm transition hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          )}

          {isLoaded && (
            isSignedIn ? (
              <UserButton />
            ) : (
              <SignInButton mode="modal">
                <button className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50">
                  Sign in
                </button>
              </SignInButton>
            )
          )}
        </div>
      </div>
    </header>
  );
}

function AdminNavLink({ userId }: { userId: string }) {
  const [showAdminLink, setShowAdminLink] = useState(
    () => adminAccessCache.get(userId) ?? false
  );

  useEffect(() => {
    let active = true;
    const cachedAccess = adminAccessCache.get(userId);

    if (cachedAccess !== undefined) {
      return () => {
        active = false;
      };
    }

    void fetch("/api/admins/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: AdminAccessResponse) => {
        const canManageAdmins = Boolean(json.access?.canManageAdmins);
        adminAccessCache.set(userId, canManageAdmins);

        if (active) {
          setShowAdminLink(canManageAdmins);
        }
      })
      .catch(() => {
        adminAccessCache.set(userId, false);

        if (active) {
          setShowAdminLink(false);
        }
      });

    return () => {
      active = false;
    };
  }, [userId]);

  if (!showAdminLink) return null;

  return (
    <Link
      href="/admin"
      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      Admin
    </Link>
  );
}

type AdminAccessResponse = {
  access?: {
    canManageAdmins?: boolean;
  };
};

function formatLastSyncedAt(value?: string | null) {
  if (!value) return "Never";

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
