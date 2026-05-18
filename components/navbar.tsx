"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { RefreshCw, ArrowLeft, Plus, X, Loader2 } from "lucide-react";

interface NavbarProps {
  backHref?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

/** Extract PR ID from a Bitbucket URL or plain number string */
function parsePrId(input: string): string | null {
  const trimmed = input.trim();
  // URL format: .../pull-requests/1234/...
  const urlMatch = trimmed.match(/pull-requests\/(\d+)/i);
  if (urlMatch) return urlMatch[1];
  // Plain number
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

export function Navbar({ backHref, onRefresh, refreshing }: NavbarProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function openModal() {
    setInput("");
    setAddError(null);
    setModalOpen(true);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const prId = parsePrId(input);
    if (!prId) {
      setAddError("Enter a valid PR ID or Bitbucket PR URL.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch("/api/pr-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: "hyper-widget", prId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      if (json.ignored) throw new Error(json.reason || "PR was ignored (not a release branch)");
      setModalOpen(false);
      router.push(`/pr/${prId}`);
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-blue-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Left */}
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

          {/* Right */}
          <div className="flex items-center gap-3">
            <button
              onClick={openModal}
              title="Add a PR"
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add PR
            </button>
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
            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded-lg border border-blue-200 bg-white px-4 py-1.5 text-sm font-medium text-blue-600 shadow-sm transition hover:bg-blue-50">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
            </SignedIn>
          </div>
        </div>
      </header>

      {/* Add PR modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-blue-100 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-base font-semibold text-blue-900">Add a PR</span>
              <button onClick={() => setModalOpen(false)} className="text-blue-300 hover:text-blue-500">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">
                  PR ID or Bitbucket URL
                </label>
                <input
                  autoFocus
                  type="text"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setAddError(null); }}
                  placeholder="e.g. 6995 or https://bitbucket.juspay.net/…/6995/overview"
                  className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {addError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  {addError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg px-4 py-1.5 text-sm text-blue-400 hover:text-blue-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding || !input.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {adding ? "Syncing…" : "Add & Sync"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
