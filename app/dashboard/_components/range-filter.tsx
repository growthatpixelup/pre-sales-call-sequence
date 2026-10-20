"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COMPARE_MODES, RANGE_PRESETS, type CompareMode, type RangePreset } from "@/lib/analytics";

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
    if (next.compare !== "none") params.set("compare", next.compare);
    if (next.range === "custom" && next.from && next.to) {
      params.set("from", next.from);
      params.set("to", next.to);
    }
    startTransition(() => router.push(`/dashboard?${params}`, { scroll: false }));
  };

  return (
    <div className="grid gap-3" aria-busy={pending}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className="chip cursor-pointer bg-transparent"
            aria-pressed={range === p.value}
            onClick={() => {
              setRange(p.value);
              if (p.value !== "custom") go({ range: p.value, compare });
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
              className="input input-sm"
            />
            <span className="mono-label">to</span>
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
              className="input input-sm"
            />
            <button type="submit" className="action action-blue">
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
              onChange={(e) => go({ range: preset, compare: e.target.value as CompareMode, from, to })}
              className="input input-sm"
            >
              {COMPARE_MODES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value === "none" ? c.label : `Compare: ${c.label.toLowerCase()}`}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="mono-label" aria-live="polite">
          {pending ? "Updating…" : ""}
        </span>
      </div>
    </div>
  );
}
