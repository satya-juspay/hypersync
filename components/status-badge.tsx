import { AlertTriangle, CheckCircle2 } from "lucide-react";

export function StatusBadge({ status }: { status: string }) {
  if (status === "SYNCED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Synced
      </span>
    );
  if (status === "MAIN_PR_OPEN")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
        <AlertTriangle className="h-3 w-3" /> Main PR Open
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
      <AlertTriangle className="h-3 w-3" /> Missing Main PR
    </span>
  );
}
