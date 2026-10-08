"use client";

import type { ReactNode } from "react";
import { SummaryInfo } from "@/components/summary-info";

type SummaryFilterCardProps = {
  label: string;
  value: number;
  infoId: string;
  infoText: string;
  infoAlign?: "center" | "end";
  icon: ReactNode;
  cardClassName: string;
  labelClassName: string;
  valueClassName: string;
  activeClassName: string;
  active: boolean;
  onSelect: () => void;
};

export function SummaryFilterCard({ label, value, infoId, infoText, infoAlign, icon,
  cardClassName, labelClassName, valueClassName, activeClassName, active, onSelect,
}: SummaryFilterCardProps) {
  return (
    <div className={`relative rounded-xl border p-5 shadow-sm transition hover:shadow-md ${cardClassName} ${active ? `ring-2 ${activeClassName}` : ""}`}>
      <button type="button" aria-label={`Filter by ${label}`} aria-pressed={active} onClick={onSelect}
        className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500" />
      <div className="pointer-events-none relative z-10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className={`text-sm font-medium ${labelClassName}`}>{label}</p>
            <span className="pointer-events-auto shrink-0">
              <SummaryInfo id={infoId} text={infoText} align={infoAlign} />
            </span>
          </div>
          <span className="shrink-0">{icon}</span>
        </div>
        <p className={`mt-2 text-4xl font-bold ${valueClassName}`}>{value}</p>
      </div>
    </div>
  );
}
