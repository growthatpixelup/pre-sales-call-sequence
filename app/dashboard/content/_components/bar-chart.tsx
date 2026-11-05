"use client";

import { useState } from "react";
import { formatCompact } from "@/lib/content/format";

export interface ChartSeries {
  label: string;
  /** A Tailwind background class from the theme, e.g. "bg-series-x". */
  colorClass: string;
}

export interface ChartPoint {
  label: string;
  /** One value per series, in series order. */
  values: number[];
}

/**
 * Columns, stacked when there's more than one series, with a hover/focus tooltip, a legend for two
 * or more series, and a "Show as table" view of the same numbers.
 */
export function BarChart({
  points,
  series,
  measure,
  firstColumn = "Period",
}: {
  points: ChartPoint[];
  series: ChartSeries[];
  /** What the numbers are, e.g. "Impressions". */
  measure: string;
  firstColumn?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = points.map((p) => p.values.reduce((n, v) => n + v, 0));
  const ticks = niceTicks(Math.max(1, ...totals));
  const top = ticks[ticks.length - 1];
  const pct = (v: number) => (v / top) * 100;
  const every = Math.max(1, Math.ceil(points.length / 8));
  const showLabel = (i: number) => i === points.length - 1 || (i % every === 0 && points.length - 1 - i >= every / 2);
  const stacked = series.length > 1;

  return (
    <div>
      {stacked && (
        <div className="mono-label mb-4 flex flex-wrap gap-5" aria-label="Legend">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className={`size-2.5 ${s.colorClass}`} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative h-56 w-10 shrink-0 text-right font-mono text-[11px] text-muted tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${pct(t)}%` }}>
              {formatCompact(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="relative h-56">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${pct(t)}%` }} aria-hidden />
            ))}

            <div className="absolute inset-0 flex">
              {points.map((p, i) => (
                <div
                  key={`${p.label}-${i}`}
                  tabIndex={0}
                  role="img"
                  aria-label={`${p.label}: ${series.map((s, k) => `${s.label} ${formatCompact(p.values[k] ?? 0)}`).join(", ")}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={`relative flex h-full flex-1 flex-col-reverse items-center px-px outline-none ${active === i ? "bg-panel" : ""}`}
                >
                  {series.map((s, k) =>
                    (p.values[k] ?? 0) > 0 ? (
                      <div
                        key={s.label}
                        // A 2px surface gap between stacked segments keeps them distinct.
                        className={`w-full max-w-7 ${s.colorClass} ${k > 0 ? "border-b-2 border-bg" : ""} ${active === i ? "opacity-90" : ""}`}
                        style={{ height: `${pct(p.values[k] ?? 0)}%` }}
                      />
                    ) : null,
                  )}
                </div>
              ))}
            </div>

            {active != null && (
              <div
                className="pointer-events-none absolute -top-2 z-10 w-max border border-line-2 bg-panel px-3 py-2 text-xs"
                style={{
                  left: `${((active + 0.5) / points.length) * 100}%`,
                  transform: `translate(${active / points.length > 0.7 ? "-100%" : active / points.length < 0.3 ? "0" : "-50%"}, -100%)`,
                }}
              >
                <div className="font-mono tracking-[0.06em] text-muted uppercase">{points[active].label}</div>
                {series.map((s, k) => (
                  <div key={s.label} className="mt-1 flex items-center gap-2">
                    <span className={`size-2 ${s.colorClass}`} />
                    <span className="text-muted">{s.label}</span>
                    <span className="ml-auto pl-3 font-display text-sm font-medium tabular-nums">
                      {formatCompact(points[active].values[k] ?? 0)}
                    </span>
                  </div>
                ))}
                {stacked && (
                  <div className="mt-1 flex items-center gap-2 border-t border-line pt-1">
                    <span className="text-muted">Total</span>
                    <span className="ml-auto pl-3 font-display text-sm font-medium tabular-nums">{formatCompact(totals[active])}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-2 flex font-mono text-[11px] text-muted" aria-hidden>
            {points.map((p, i) => (
              <div key={`${p.label}-${i}`} className="relative flex-1">
                {showLabel(i) && (
                  <span
                    className={`absolute whitespace-nowrap ${i === points.length - 1 ? "right-0" : i === 0 ? "left-0" : "left-1/2 -translate-x-1/2"}`}
                  >
                    {p.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <details className="mt-10">
        <summary className="mono-label cursor-pointer hover:text-text">Show as table</summary>
        <div className="overflow-x-auto">
          <table className="table mt-3">
            <thead>
              <tr>
                <th>{firstColumn}</th>
                {series.map((s) => (
                  <th key={s.label} className="text-right">
                    {stacked ? s.label : measure}
                  </th>
                ))}
                {stacked && <th className="text-right">Total</th>}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((p, i) => (
                <tr key={`${p.label}-${i}`}>
                  <td>{p.label}</td>
                  {series.map((s, k) => (
                    <td key={s.label} className="text-right">
                      {(p.values[k] ?? 0).toLocaleString("en-US")}
                    </td>
                  ))}
                  {stacked && <td className="text-right">{totals[i].toLocaleString("en-US")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** 0 plus 3–5 evenly spaced round ticks covering `max` (steps of 1, 2, 2.5 or 5 × 10ⁿ). */
function niceTicks(max: number): number[] {
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
