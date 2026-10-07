import { Info } from "lucide-react";

export function SummaryInfo({
  id,
  text,
  align = "center",
}: {
  id: string;
  text: string;
  align?: "center" | "end";
}) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="About this metric"
        aria-describedby={id}
        className="rounded-full text-slate-400 outline-none transition hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-30 mt-2 w-56 rounded-lg bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 ${
          align === "end"
            ? "right-0 max-w-[calc(50vw-2rem)] sm:max-w-none"
            : "left-1/2 -translate-x-1/2"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
