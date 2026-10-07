"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Filter, Search, X } from "lucide-react";
import {
  UI_COMPONENT_PAGE_SIZES, UI_COMPONENT_SORT_OPTIONS, UI_COMPONENT_STATUSES,
  UI_COMPONENT_STATUS_LABELS, sameUiComponentStatuses, type UiComponentListView,
} from "@/lib/ui-component-filters";

export function UiComponentListFilters({ view, authors, branches, total, onChange }: {
  view: UiComponentListView;
  authors: string[];
  branches: string[];
  total: number;
  onChange: (patch: Partial<UiComponentListView>) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const allStatuses = sameUiComponentStatuses(view.statuses, UI_COMPONENT_STATUSES);
  const filterCount = Number(!allStatuses) + Number(!!view.author) + Number(!!view.branch);
  const hasFilters = filterCount > 0 || !!view.query.trim();
  const currentPage = Math.min(view.page, Math.max(1, Math.ceil(total / view.pageSize)));
  const start = total === 0 ? 0 : (currentPage - 1) * view.pageSize + 1;
  const end = Math.min(currentPage * view.pageSize, total);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <section aria-label="Release commit filters" className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="relative min-w-0 flex-1 basis-56 sm:max-w-md">
        <span className="sr-only">Search commits or main PRs</span>
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-400" />
        <input value={view.query} onChange={(event) => onChange({ query: event.target.value })} placeholder="Search commit, author, branch or main PR…"
          className="w-full rounded-lg border border-blue-200 bg-surface py-2 pl-9 pr-4 text-sm text-blue-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <div ref={containerRef} className="relative">
          <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog" onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-surface px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
            <Filter aria-hidden="true" className="h-3.5 w-3.5" />Filters
            {filterCount > 0 && <span aria-label={`${filterCount} active filters`} className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] leading-none text-blue-700">{filterCount}</span>}
          </button>
          {open && <div ref={panelRef} id={panelId} role="dialog" aria-label="Commit filters"
            className="fixed inset-x-3 bottom-3 z-40 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-lg border border-blue-100 bg-surface p-4 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[70dvh] sm:w-80">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-blue-900">Filters</span>
              <button type="button" aria-label="Close filters" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} className="rounded-md p-1 text-blue-400 transition hover:bg-blue-50 hover:text-blue-600"><X aria-hidden="true" className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wider text-blue-400">Status</legend>
                <div className="mt-1 flex items-center justify-end gap-2 text-[11px] font-semibold">
                  <button type="button" disabled={allStatuses} onClick={() => onChange({ statuses: [...UI_COMPONENT_STATUSES] })} className="text-blue-600 hover:text-blue-800 disabled:cursor-default disabled:text-blue-200">Select all</button>
                  <button type="button" disabled={view.statuses.length === 0} onClick={() => onChange({ statuses: [] })} className="text-red-500 hover:text-red-700 disabled:cursor-default disabled:text-red-200">Remove all</button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {UI_COMPONENT_STATUSES.map((status) => <label key={status} className="flex cursor-pointer items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/40 px-2.5 py-2 text-xs font-medium text-blue-800 transition hover:bg-blue-50">
                    <input type="checkbox" checked={view.statuses.includes(status)} onChange={() => onChange({ statuses: UI_COMPONENT_STATUSES.filter((value) => value === status ? !view.statuses.includes(value) : view.statuses.includes(value)) })} className="h-4 w-4 shrink-0 rounded border-blue-300 accent-primary" />
                    {UI_COMPONENT_STATUS_LABELS[status]}
                  </label>)}
                </div>
                <p className="mt-2 text-[11px] text-blue-400">{view.statuses.length} of {UI_COMPONENT_STATUSES.length} selected</p>
              </fieldset>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">Author</span>
                <select value={view.author} onChange={(event) => onChange({ author: event.target.value })} className="w-full min-w-0 rounded-lg border border-blue-200 bg-surface px-3 py-2 text-sm text-blue-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                  <option value="">All authors</option>{authors.map((author) => <option key={author} value={author}>{author}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">Release branch</span>
                <select value={view.branch} onChange={(event) => onChange({ branch: event.target.value })} className="w-full min-w-0 rounded-lg border border-blue-200 bg-surface px-3 py-2 text-sm text-blue-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                  <option value="">All release branches</option>{branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
                </select>
              </label>
              <div>
                <label htmlFor={`${panelId}-sort`} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-blue-400">Sort by</label>
                <div className="flex gap-2">
                  <select id={`${panelId}-sort`} value={view.sortBy} onChange={(event) => onChange({ sortBy: event.target.value as UiComponentListView["sortBy"] })} className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-surface px-3 py-2 text-sm text-blue-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
                    {UI_COMPONENT_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button type="button" aria-label={view.sortDirection === "asc" ? "Sorted ascending; switch to descending" : "Sorted descending; switch to ascending"} onClick={() => onChange({ sortDirection: view.sortDirection === "asc" ? "desc" : "asc" })}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-surface text-blue-600 shadow-sm transition hover:bg-blue-50">
                    {view.sortDirection === "asc" ? <ArrowUp aria-hidden="true" className="h-4 w-4" /> : <ArrowDown aria-hidden="true" className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>}
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-blue-500">Rows
          <select value={view.pageSize} onChange={(event) => onChange({ pageSize: Number(event.target.value) as UiComponentListView["pageSize"] })} className="rounded-lg border border-blue-200 bg-surface px-2 py-1.5 text-xs font-semibold text-blue-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
            {UI_COMPONENT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <p className="text-xs text-blue-400">Showing <strong className="text-blue-700">{start}–{end}</strong> of <strong className="text-blue-700">{total}</strong> commits</p>
      </div>
    </div>
    {hasFilters && <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-blue-400">Active filters:</span>
      {view.query.trim() && <FilterChip label={`Search: ${view.query.trim()}`} onRemove={() => onChange({ query: "" })} />}
      {view.author && <FilterChip label={`Author: ${view.author}`} onRemove={() => onChange({ author: "" })} />}
      {view.branch && <FilterChip label={`Release branch: ${view.branch}`} onRemove={() => onChange({ branch: "" })} />}
      {!allStatuses && <FilterChip label={`Status: ${view.statuses.length ? view.statuses.map((status) => UI_COMPONENT_STATUS_LABELS[status]).join(", ") : "None selected"}`} onRemove={() => onChange({ statuses: [...UI_COMPONENT_STATUSES] })} />}
      <button type="button" onClick={() => onChange({ query: "", author: "", branch: "", statuses: [...UI_COMPONENT_STATUSES] })} className="rounded px-1 py-0.5 text-xs font-semibold text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">Clear filters</button>
    </div>}
  </section>;
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-surface px-2.5 py-1 text-xs font-medium text-blue-700 shadow-sm">
    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
    <button type="button" onClick={onRemove} aria-label={`Remove ${label} filter`} className="shrink-0 rounded-full text-blue-400 transition hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"><X aria-hidden="true" className="h-3 w-3" /></button>
  </span>;
}
