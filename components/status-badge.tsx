import { AlertTriangle, Ban, CheckCircle2, Clock, ThumbsUp } from "lucide-react";
import type { ReleasePRStatus } from "@/types/hypersync";

export function StatusBadge({ status }: { status: ReleasePRStatus }) {
  if (status === "MERGED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Merged
      </span>
    );

  if (status === "OPEN")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
        <Clock className="h-3 w-3" /> Open
      </span>
    );

  if (status === "DECLINED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
        <Ban className="h-3 w-3" /> Declined
      </span>
    );

  if (status === "INVALID")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
        <AlertTriangle className="h-3 w-3" /> Invalid
      </span>
    );

  if (status === "APPROVED")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">
        <ThumbsUp className="h-3 w-3" /> Approved
      </span>
    );

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
      <AlertTriangle className="h-3 w-3" /> Missing
    </span>
  );
}
