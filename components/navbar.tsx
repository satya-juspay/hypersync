"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ShieldCheck, SunMoon } from "lucide-react";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";

const adminAccessCache = new Map<string, boolean>();
type ThemePreference = "system" | "light" | "dark";

interface NavbarProps {
  backHref?: string;
  lastSyncedAt?: string | null;
}

export function Navbar({
  backHref,
  lastSyncedAt,
}: NavbarProps) {
  const { isSignedIn, isLoaded, userId } = useAuth();
  const pathname = usePathname();
  const repositoryLinks = (
    <nav aria-label="Repositories" className="flex items-center rounded-lg border border-blue-100 bg-surface p-0.5 text-xs font-semibold shadow-sm">
      {[{ href: "/", label: "hyper-widget", active: !pathname.startsWith("/ui-components") },
        { href: "/ui-components", label: "ui-components", active: pathname.startsWith("/ui-components") }].map((repo) => (
        <Link key={repo.href} href={repo.href} aria-current={repo.active ? "page" : undefined}
          className={`rounded-md px-2.5 py-1.5 transition ${repo.active ? "bg-primary text-white" : "text-blue-500 hover:bg-blue-50 hover:text-blue-700"}`}>
          {repo.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-blue-100 bg-surface/90 backdrop-blur-md">
      <div className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-y-2 px-3 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="rounded-lg border border-blue-100 bg-surface p-1.5 text-blue-400 shadow-sm transition hover:bg-blue-50 hover:text-blue-600"
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
              className="wordmark h-7 w-auto sm:h-9"
              priority
            />
          </Link>
          <span className="hidden rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-700 sm:inline-flex">
            2026
          </span>
        </div>

        <div className="absolute left-1/2 hidden -translate-x-1/2 lg:block">{repositoryLinks}</div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {isLoaded && isSignedIn && (
            <AdminNavLink userId={userId ?? "signed-in"} />
          )}
          <span className="hidden text-xs font-medium text-blue-500 xl:inline">
            Last sync:{" "}
            <span className="text-blue-800">{formatLastSyncedAt(lastSyncedAt)}</span>
          </span>
          <ThemeSelect />
          {isLoaded && (
            isSignedIn ? (
              <UserButton />
            ) : (
              <SignInButton mode="modal">
                <button className="rounded-lg border border-blue-200 bg-surface px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50">
                  Sign in
                </button>
              </SignInButton>
            )
          )}
        </div>
        <div className="flex w-full items-center justify-between gap-2 lg:hidden">{repositoryLinks}</div>
        <span className="w-full text-right text-xs font-medium text-blue-500 xl:hidden">
          Last sync:{" "}
          <span className="text-blue-800">{formatLastSyncedAt(lastSyncedAt)}</span>
        </span>
      </div>
    </header>
  );
}

function ThemeSelect() {
  const selectRef = useRef<HTMLSelectElement>(null);
  const preferenceRef = useRef<ThemePreference>("system");

  useEffect(() => {
    let savedPreference: string | null = null;
    try {
      savedPreference = localStorage.getItem("hypersync-theme");
    } catch {}

    const preference: ThemePreference =
      savedPreference === "light" || savedPreference === "dark"
        ? savedPreference
        : "system";
    preferenceRef.current = preference;
    if (selectRef.current) selectRef.current.value = preference;

    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const followBrowser = () => {
      if (preferenceRef.current === "system") {
        document.documentElement.dataset.theme = colorScheme.matches
          ? "dark"
          : "light";
      }
    };

    followBrowser();
    colorScheme.addEventListener("change", followBrowser);
    return () => colorScheme.removeEventListener("change", followBrowser);
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const preference = event.currentTarget.value as ThemePreference;
    preferenceRef.current = preference;
    document.documentElement.dataset.theme =
      preference === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preference;
    try {
      localStorage.setItem("hypersync-theme", preference);
    } catch {}
  }

  return (
    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-surface text-blue-700 shadow-sm transition hover:bg-blue-50 focus-within:ring-2 focus-within:ring-blue-400">
      <SunMoon aria-hidden="true" className="h-4 w-4" />
      <select
        ref={selectRef}
        aria-label="Theme"
        title="Theme"
        defaultValue="system"
        onChange={handleChange}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        <option value="system">Browser default</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </span>
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-surface px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
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
