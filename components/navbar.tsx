"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";

const adminAccessCache = new Map<string, boolean>();

interface NavbarProps {
  backHref?: string;
  lastSyncedAt?: string | null;
}

export function Navbar({
  backHref,
  lastSyncedAt,
}: NavbarProps) {
  const { isSignedIn, isLoaded, userId } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-blue-100 bg-white/90 backdrop-blur-md">
      <div className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
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
          <Link href="/" aria-label="hyperSync home">
            <Image
              src="/hypersync-wordmark.png"
              alt="hyperSync"
              width={168}
              height={40}
              className="h-9 w-auto"
              priority
            />
          </Link>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-700">
            2026
          </span>
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center overflow-visible rounded-lg border border-blue-100 bg-white p-0.5 text-xs font-semibold shadow-sm sm:flex">
          <span className="rounded-md bg-blue-600 px-2.5 py-1 text-white">
            hyper-widget
          </span>
          <span className="group relative ml-0.5 cursor-not-allowed rounded-md px-2.5 py-1 text-blue-300" aria-disabled="true">
            ui-components
            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-max -translate-x-1/2 rounded-md bg-blue-950 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
            >
              Releasing soon
            </span>
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
