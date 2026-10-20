"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COMPARE_MODES, RANGE_PRESETS, type CompareMode, type RangePreset } from "@/lib/analytics";

const SELECT =
  "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Date range and comparison for the overview. Changes go into the URL, so views can be shared. */
export function RangeFilter({
  preset,
  compare,
  from,
  to,
}: {
  preset: RangePreset;
  compare: CompareMode;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useState(preset);
  const [custom, setCustom] = useState({ from, to });

  const go = (next: { range: RangePreset; compare: CompareMode; from?: string; to?: string }) => {
    const params = new URLSearchParams({ range: next.range });
    if (next.compare !== "previous") params.set("compare", next.compare);
    if (next.range === "custom" && next.from && next.to) {
      params.set("from", next.from);
      params.set("to", next.to);
    }
    startTransition(() => router.push(`/dashboard?${params}`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label className="sr-only" htmlFor="range">
        Date range
      </label>
      <select
        id="range"
        value={range}
        onChange={(e) => {
          const value = e.target.value as RangePreset;
          setRange(value);
          if (value !== "custom") go({ range: value, compare });
        }}
        className={SELECT}
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      {range === "custom" && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ range: "custom", compare, ...custom });
          }}
        >
          <label className="sr-only" htmlFor="range-from">
            From
          </label>
          <input
            id="range-from"
            type="date"
            required
            value={custom.from}
            max={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            className={SELECT}
          />
          <span className="text-sm text-zinc-500">to</span>
          <label className="sr-only" htmlFor="range-to">
            To
          </label>
          <input
            id="range-to"
            type="date"
            required
            value={custom.to}
            min={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            className={SELECT}
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Apply
          </button>
        </form>
      )}

      {preset !== "all" && (
        <>
          <label className="sr-only" htmlFor="compare">
            Compare to
          </label>
          <select
            id="compare"
            value={compare}
            onChange={(e) =>
              go({ range: preset, compare: e.target.value as CompareMode, from, to })
            }
            className={SELECT}
          >
            {COMPARE_MODES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.value === "none" ? c.label : `Compare: ${c.label.toLowerCase()}`}
              </option>
            ))}
          </select>
        </>
      )}
      {pending && <span className="text-xs text-zinc-500 dark:text-zinc-400">Updating…</span>}
    </div>
  );
}
