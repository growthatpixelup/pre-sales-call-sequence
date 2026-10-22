"use client";

import { useState, type ReactNode } from "react";
import { formatMoneyCompact, type AttributionRow } from "@/lib/analytics";

type View = "channel" | "source";

interface Slice {
  key: string;
  label: string;
  booked: number;
  live: number;
  won?: number;
  value?: number;
  /** Sources shown as small marks inside the slice. */
  marks: string[];
  color: string;
}

// Blue fading into the panel, brightest first. "Not answered" is always grey.
const SHADES = [100, 74, 56, 42, 31, 23, 17].map((p) => `color-mix(in oklab, var(--blue) ${p}%, var(--panel-2))`);
const UNANSWERED = "var(--line-2)";
const MAX_SOURCES = 7;

/** Short marks for known sources, drawn inside their slice. */
const MARKS: Record<string, string> = {
  "X / Twitter": "𝕏",
  LinkedIn: "in",
  "Other social": "@",
  "YC referral": "Y",
  "YC forum": "Y",
  Referral: "↗",
  "Past client": "★",
  "AI search": "AI",
  "Google search": "G",
};

// Geometry, in viewBox units.
const W = 560;
const H = 340;
const CX = W / 2;
const CY = H / 2;
const R = 122;
const r = 74;
const GAP = 4;

/** "How they found us" as a donut, by channel or by individual source. */
export function SourceDonut({ rows }: { rows: AttributionRow[] }) {
  const [view, setView] = useState<View>("channel");
  const [active, setActive] = useState<string | null>(null);
  const slices = view === "channel" ? channelSlices(rows) : sourceSlices(rows);
  const total = slices.reduce((n, s) => n + s.booked, 0);
  const arcs = layout(slices, total);
  const hovered = slices.find((s) => s.key === active) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label="Group by">
          {(["channel", "source"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="chip cursor-pointer bg-transparent"
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setActive(null);
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <span className="mono-label">All ({total})</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 block h-auto w-full" role="group" aria-label="Calls booked by how they found us">
        {arcs.map((a) => {
          const dim = active != null && active !== a.slice.key;
          return (
            <g
              key={a.slice.key}
              tabIndex={0}
              role="img"
              aria-label={`${a.slice.label}: ${a.slice.booked} booked, ${pct(a.slice.booked, total)}`}
              onPointerEnter={() => setActive(a.slice.key)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(a.slice.key)}
              onBlur={() => setActive(null)}
              className="cursor-default outline-none transition-opacity duration-150"
              style={{ opacity: dim ? 0.35 : 1 }}
            >
              <path d={a.path} fill={a.slice.color} stroke={active === a.slice.key ? "var(--text)" : "none"} strokeWidth={1} />
              {a.marks}
              <polyline points={a.leader} fill="none" stroke={a.slice.color === UNANSWERED ? "var(--hint)" : a.slice.color} strokeWidth={1.5} />
              <text
                x={a.labelX}
                y={a.labelY}
                textAnchor={a.right ? "start" : "end"}
                dominantBaseline="middle"
                className="fill-text font-sans"
                fontSize={14}
              >
                {a.slice.label}
                <tspan className="fill-muted" fontSize={12} dx={6}>
                  {pct(a.slice.booked, total)}
                </tspan>
              </text>
            </g>
          );
        })}

        {/* Centre: total, or the hovered slice */}
        <text x={CX} y={CY - 6} textAnchor="middle" className="fill-text font-display" fontSize={30} fontWeight={500}>
          {hovered ? hovered.booked : total}
        </text>
        <text x={CX} y={CY + 18} textAnchor="middle" className="fill-muted font-mono uppercase" fontSize={10} letterSpacing="0.07em">
          {hovered ? `${hovered.live} going ahead` : "calls booked"}
        </text>
        {hovered?.won ? (
          <text x={CX} y={CY + 34} textAnchor="middle" className="fill-muted font-mono uppercase" fontSize={10} letterSpacing="0.07em">
            {hovered.won} won{hovered.value ? ` · ${formatMoneyCompact(hovered.value)}` : ""}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

function pct(n: number, total: number) {
  return `${Math.round((n / total) * 100)}%`;
}

function channelSlices(rows: AttributionRow[]): Slice[] {
  let shade = 0;
  return rows
    .filter((r) => r.booked > 0)
    .map((r) => ({
      key: r.pillar,
      label: r.pillar,
      booked: r.booked,
      live: r.live,
      won: r.won,
      value: r.value,
      marks: [...new Set(r.sources.map((s) => MARKS[s.source]).filter(Boolean))].slice(0, 3),
      color: r.pillar === "Not answered" ? UNANSWERED : SHADES[shade++ % SHADES.length],
    }));
}

/** Every source, biggest first. Past MAX_SOURCES, the rest share one slice. */
function sourceSlices(rows: AttributionRow[]): Slice[] {
  const all = rows
    .flatMap((r) => r.sources.map((s) => ({ ...s, pillar: r.pillar })))
    .sort((a, b) => b.booked - a.booked);
  const answered = all.filter((s) => s.pillar !== "Not answered");
  const unanswered = all.filter((s) => s.pillar === "Not answered");
  const shown = answered.slice(0, MAX_SOURCES - 1);
  const rest = answered.slice(MAX_SOURCES - 1);
  const slices: Slice[] = shown.map((s, i) => ({
    key: s.source,
    label: s.source.length > 22 ? `${s.source.slice(0, 21)}…` : s.source,
    booked: s.booked,
    live: s.live,
    marks: MARKS[s.source] ? [MARKS[s.source]] : [],
    color: SHADES[i % SHADES.length],
  }));
  if (rest.length) {
    slices.push({
      key: "rest",
      label: `${rest.length} more`,
      booked: rest.reduce((n, s) => n + s.booked, 0),
      live: rest.reduce((n, s) => n + s.live, 0),
      marks: [],
      color: SHADES[SHADES.length - 1],
    });
  }
  for (const s of unanswered) slices.push({ key: s.source, label: s.source, booked: s.booked, live: s.live, marks: [], color: UNANSWERED });
  return slices;
}

interface Arc {
  slice: Slice;
  path: string;
  marks: ReactNode;
  leader: string;
  labelX: number;
  labelY: number;
  right: boolean;
}

/** Angles clockwise from 12 o'clock, in radians. */
function point(angle: number, radius: number) {
  return [CX + radius * Math.sin(angle), CY - radius * Math.cos(angle)] as const;
}

function layout(slices: Slice[], total: number): Arc[] {
  if (!total) return [];
  let start = 0;
  const arcs = slices.map((slice) => {
    const sweep = (slice.booked / total) * Math.PI * 2;
    const end = start + sweep;
    const mid = start + sweep / 2;
    const arc = { slice, start, end, mid };
    start = end;
    return arc;
  });
  const single = arcs.length === 1;

  // Labels: elbow out from the slice, then nudged apart so neighbours don't overlap.
  const labels = arcs.map((a) => {
    const right = Math.sin(a.mid) >= 0;
    const [ex, ey] = point(a.mid, R + 18);
    return { right, y: ey, ex };
  });
  for (const side of [true, false]) {
    const group = labels.filter((l) => l.right === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < group.length; i++) group[i].y = Math.max(group[i].y, group[i - 1].y + 22);
    const overflow = group.length ? group[group.length - 1].y - (H - 12) : 0;
    if (overflow > 0) for (const l of group) l.y -= overflow;
    for (let i = group.length - 2; i >= 0; i--) group[i].y = Math.min(group[i].y, group[i + 1].y - 22);
  }

  return arcs.map((a, i) => {
    const { right, y, ex } = labels[i];
    const [sx, sy] = point(a.mid, R + 4);
    const kx = right ? Math.max(ex, CX + 40) : Math.min(ex, CX - 40);
    const tx = right ? kx + 16 : kx - 16;
    return {
      slice: a.slice,
      path: single ? ring() : sector(a.start, a.end),
      marks: marksFor(a.slice, a.mid, a.end - a.start),
      leader: `${sx},${sy} ${kx},${y} ${tx},${y}`,
      labelX: right ? tx + 6 : tx - 6,
      labelY: y,
      right,
    };
  });
}

/** An annular sector with a constant-width gap on each side. */
function sector(start: number, end: number) {
  const padOuter = GAP / 2 / R;
  const padInner = GAP / 2 / r;
  const a0 = start + padOuter;
  const a1 = Math.max(a0, end - padOuter);
  const b0 = start + padInner;
  const b1 = Math.max(b0, end - padInner);
  const large = (a: number, b: number) => (b - a > Math.PI ? 1 : 0);
  const [o0x, o0y] = point(a0, R);
  const [o1x, o1y] = point(a1, R);
  const [i1x, i1y] = point(b1, r);
  const [i0x, i0y] = point(b0, r);
  return `M${o0x},${o0y} A${R},${R} 0 ${large(a0, a1)} 1 ${o1x},${o1y} L${i1x},${i1y} A${r},${r} 0 ${large(b0, b1)} 0 ${i0x},${i0y} Z`;
}

function ring() {
  return `M${CX},${CY - R} A${R},${R} 0 1 1 ${CX - 0.01},${CY - R} Z M${CX},${CY - r} A${r},${r} 0 1 0 ${CX - 0.01},${CY - r} Z`;
}

/** Small square marks for the slice's sources, centred in the slice when it's wide enough. */
function marksFor(slice: Slice, mid: number, sweep: number) {
  const size = 18;
  const step = size + 3;
  const fits = Math.floor((sweep * ((R + r) / 2) - 8) / step);
  const marks = slice.marks.slice(0, Math.max(0, Math.min(3, fits)));
  if (!marks.length) return null;
  const [cx, cy] = point(mid, (R + r) / 2);
  const x0 = cx - (marks.length * step - 3) / 2;
  return marks.map((m, i) => (
    <g key={m} aria-hidden>
      <rect x={x0 + i * step} y={cy - size / 2} width={size} height={size} fill="var(--bg)" />
      <text
        x={x0 + i * step + size / 2}
        y={cy + 0.5}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-text font-sans"
        fontSize={m.length > 1 ? 9 : 11}
        fontWeight={600}
      >
        {m}
      </text>
    </g>
  ));
}
