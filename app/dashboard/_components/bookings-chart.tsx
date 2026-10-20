"use client";

import { useState } from "react";
import type { Bucket } from "@/lib/analytics";

/** Calls booked per day/week/month as columns, with the comparison period as a line. */
export function BookingsChart({ buckets, unit }: { buckets: Bucket[]; unit: "day" | "week" | "month" }) {
  const [active, setActive] = useState<number | null>(null);
  const comparing = buckets.some((b) => b.previous != null);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.booked, b.previous ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const pct = (v: number) => (v / top) * 100;
  // At most ~8 x-axis labels, always including the first and last.
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const showLabel = (i: number) => i === buckets.length - 1 || (i % every === 0 && buckets.length - 1 - i >= every / 2);
  const hovered = active == null ? null : buckets[active];

  return (
    <div>
      {comparing && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-[#2a78d6] dark:bg-[#3987e5]" aria-hidden />
            This period
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-[#eb6834] dark:bg-[#d95926]" aria-hidden />
            Comparison period
          </span>
        </div>
      )}

      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative h-56 w-6 shrink-0 text-right text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${pct(t)}%` }}>
              {t}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="relative h-56">
            {/* Gridlines */}
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 border-t border-zinc-200 dark:border-zinc-800"
                style={{ bottom: `${pct(t)}%` }}
                aria-hidden
              />
            ))}

            {/* Columns, each with a full-height hover target */}
            <div className="absolute inset-0 flex">
              {buckets.map((b, i) => (
                <div
                  key={b.from}
                  tabIndex={0}
                  role="img"
                  aria-label={`${b.label}: ${b.booked} booked${b.previous != null ? `, ${b.previous} in ${b.previousLabel}` : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={`relative flex h-full flex-1 items-end justify-center px-px outline-none ${
                    active === i ? "bg-zinc-100/70 dark:bg-zinc-800/50" : ""
                  }`}
                >
                  {b.booked > 0 && (
                    <div
                      className="w-full max-w-6 rounded-t bg-[#2a78d6] dark:bg-[#3987e5]"
                      style={{ height: `${pct(b.booked)}%` }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Comparison line */}
            {comparing && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                viewBox={`0 0 ${buckets.length} 100`}
                preserveAspectRatio="none"
                aria-hidden
              >
                <polyline
                  fill="none"
                  className="stroke-[#eb6834] dark:stroke-[#d95926]"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  points={buckets
                    .map((b, i) => (b.previous == null ? null : `${i + 0.5},${100 - pct(b.previous)}`))
                    .filter(Boolean)
                    .join(" ")}
                />
              </svg>
            )}

            {/* Tooltip */}
            {hovered && active != null && (
              <div
                className="pointer-events-none absolute -top-2 z-10 w-max rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900"
                style={{
                  left: `${((active + 0.5) / buckets.length) * 100}%`,
                  transform: `translate(${active / buckets.length > 0.7 ? "-100%" : active / buckets.length < 0.3 ? "0" : "-50%"}, -100%)`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" />
                  <span className="text-sm font-semibold tabular-nums">{hovered.booked}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">{hovered.label}</span>
                </div>
                {hovered.previous != null && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="h-0.5 w-3 rounded-full bg-[#eb6834] dark:bg-[#d95926]" />
                    <span className="text-sm font-semibold tabular-nums">{hovered.previous}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{hovered.previousLabel}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* X axis */}
          <div className="mt-2 flex text-[11px] text-zinc-500 dark:text-zinc-400" aria-hidden>
            {buckets.map((b, i) => (
              <div key={b.from} className="relative flex-1">
                {showLabel(i) && (
                  <span className={`absolute whitespace-nowrap ${i === buckets.length - 1 ? "right-0" : i === 0 ? "left-0" : "left-1/2 -translate-x-1/2"}`}>
                    {unit === "week" ? b.label.split(" – ")[0] : b.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <details className="mt-8">
        <summary className="cursor-pointer text-xs text-zinc-500 dark:text-zinc-400">Show as table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="py-1 pr-4 font-medium">{unit === "day" ? "Day" : unit === "week" ? "Week" : "Month"}</th>
              <th className="py-1 pr-4 text-right font-medium">Booked</th>
              {comparing && <th className="py-1 pr-4 font-medium">Comparison</th>}
              {comparing && <th className="py-1 text-right font-medium">Booked</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
            {buckets.map((b) => (
              <tr key={b.from}>
                <td className="py-1 pr-4">{b.label}</td>
                <td className="py-1 pr-4 text-right">{b.booked}</td>
                {comparing && <td className="py-1 pr-4 text-zinc-500 dark:text-zinc-400">{b.previousLabel ?? "—"}</td>}
                {comparing && <td className="py-1 text-right">{b.previous ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** 0 plus 2–5 evenly spaced whole-number ticks covering `max`. */
function niceTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => max / s <= 4) ?? Math.ceil(max / 4);
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
