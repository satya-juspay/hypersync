"use client";

const rankColors = [
  "from-red-500 to-red-400", "from-orange-500 to-amber-400", "from-amber-400 to-yellow-300",
  "from-blue-500 to-blue-400", "from-violet-500 to-violet-400",
];

export function DashboardRiskLeaderboard({ title, entries, selected, onSelect, unit, emptyMessage,
  loading = false, monospace = false, filterLabel,
}: {
  title: string;
  entries: readonly (readonly [string, number])[];
  selected: string | null;
  onSelect: (value: string) => void;
  unit: "PR" | "commit";
  emptyMessage: string;
  loading?: boolean;
  monospace?: boolean;
  filterLabel?: string;
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-blue-100 bg-surface shadow-sm">
      <div className="border-b border-blue-50 bg-blue-50/60 px-5 py-3">
        <h2 className="text-sm font-semibold text-blue-800">{title}</h2>
      </div>
      <div className="p-5">
        {entries.length > 0 ? (
          <div className="flex gap-4 overflow-x-auto pb-1">
            {entries.map(([name, count], i) => (
              <button type="button" key={name} aria-label={filterLabel ? `${filterLabel} ${name}` : undefined}
                aria-pressed={selected === name} onClick={() => onSelect(name)}
                className={`flex shrink-0 items-center gap-3 rounded-xl border bg-blue-50/40 px-5 py-4 text-left outline-none transition hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-400 ${selected === name ? "border-blue-400 ring-2 ring-blue-300" : "border-blue-100"}`}>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${rankColors[i] ?? "from-slate-400 to-slate-300"} text-sm font-bold text-white shadow`}>#{i + 1}</div>
                <div>
                  <p className={`text-sm font-semibold text-slate-800 ${monospace ? "font-mono" : ""}`}>{name}</p>
                  <p className="text-xs text-slate-500">{count} unsynced {unit}{count > 1 ? "s" : ""}</p>
                </div>
              </button>
            ))}
          </div>
        ) : !loading && <p className="text-center text-sm font-medium text-emerald-600">{emptyMessage}</p>}
      </div>
    </section>
  );
}
