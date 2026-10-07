"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { AdminManager } from "@/components/admin-manager";
import { Navbar } from "@/components/navbar";

type AdminRecord = {
  email: string;
  createdAt: string;
  createdBy: string | null;
};

type AdminAccess = {
  email: string | null;
  isAuthenticated: boolean;
  canManageAdmins: boolean;
  canRemoveAdmins: boolean;
};

type AdminsResponse = {
  success: boolean;
  superAdmin?: { email: string };
  admins?: AdminRecord[];
  access?: AdminAccess;
  error?: string;
};

export default function AdminPage() {
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [superAdminEmail, setSuperAdminEmail] = useState("");
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    async function loadAdmins() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/admins", { cache: "no-store" });
        const json = (await response.json()) as AdminsResponse;

        if (!response.ok || !json.success || !json.access) {
          throw new Error(json.error ?? "Failed to load admins");
        }

        if (!disposed) {
          setAdmins(json.admins ?? []);
          setSuperAdminEmail(json.superAdmin?.email ?? "");
          setAccess(json.access);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "Failed to load admins");
          setAccess(null);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadAdmins();

    return () => {
      disposed = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar backHref="/" />
        <main className="mx-auto max-w-5xl px-6 py-5">
          <div className="rounded-lg border border-blue-100 bg-surface p-6 text-center text-sm font-medium text-blue-900 shadow-sm">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-500" />
            Loading admin access
          </div>
        </main>
      </div>
    );
  }

  if (error || !access?.isAuthenticated || !access.canManageAdmins) {
    return (
      <AccessState
        title={
          error ??
          (!access?.isAuthenticated
            ? "Sign in required"
            : "Admin access required")
        }
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar backHref="/" />

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-100 bg-surface text-blue-600 shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-blue-900">Admin Access</h1>
            <p className="text-sm text-blue-500">{access.email}</p>
          </div>
        </div>

        <AdminManager
          initialAdmins={admins}
          superAdminEmail={superAdminEmail}
          canRemoveAdmins={access.canRemoveAdmins}
        />
      </main>
    </div>
  );
}

function AccessState({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar backHref="/" />
      <main className="mx-auto max-w-5xl px-6 py-5">
        <div className="rounded-lg border border-blue-100 bg-surface p-6 text-sm font-medium text-blue-900 shadow-sm">
          {title}
        </div>
      </main>
    </div>
  );
}
