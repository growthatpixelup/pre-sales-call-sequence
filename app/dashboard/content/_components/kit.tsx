import Link from "next/link";
import type { ReactNode } from "react";
import { formatChange } from "@/lib/content/format";
import type { SourceResult } from "@/lib/content/types";
import { Icon } from "@/app/dashboard/_components/ui";

/** Content OS building blocks: page header, stat tiles, sections, source states, filters. */

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Relative change vs the previous period (0.12 = +12%). Undefined hides it; null says "no comparison". */
  change?: number | null;
}

export function ContentHeader({
  title,
  sub,
  stats,
  links = [],
  children,
}: {
  title: string;
  sub: ReactNode;
  stats: Stat[];
  links?: { label: string; href: string }[];
  /** Filters, under the subtitle. */
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-line px-4 pt-8 pb-8 sm:px-[30px]">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="h1 m-0">{title}</h1>
          </div>
          <p className="m-0 mt-3 max-w-[62ch] text-muted">{sub}</p>
        </div>
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="action">
                {l.label}
                <Icon name="external" />
              </a>
            ))}
          </div>
        )}
      </div>
      {children && <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">{children}</div>}
      {stats.length > 0 && <StatGrid stats={stats} className="mt-8" />}
    </header>
  );
}

export function StatGrid({ stats, className = "" }: { stats: Stat[]; className?: string }) {
  return (
    <dl className={`m-0 grid grid-cols-2 border-t border-l border-line lg:grid-cols-4 ${className}`}>
      {stats.map((s) => (
        <StatTile key={s.label} {...s} />
      ))}
    </dl>
  );
}

export function StatTile({ label, value, sub, change }: Stat) {
  return (
    <div className="min-w-0 border-r border-b border-line p-4 sm:p-5">
      <dt className="mono-label">{label}</dt>
      <dd className="m-0 mt-3 font-display text-[clamp(1.5rem,2.6vw,2.1rem)] leading-none font-medium tracking-[-0.03em] tabular-nums">
        {value}
      </dd>
      {(sub != null || change !== undefined) && (
        <dd className="m-0 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.85rem] text-muted">
          {change !== undefined && <Change value={change} />}
          {sub}
        </dd>
      )}
    </div>
  );
}

/** "▲ 12%" in green or "▼ 5%" in red, with the direction in words for screen readers. */
export function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-hint">no comparison</span>;
  const up = value > 0.0005;
  const down = value < -0.0005;
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[0.8rem] tabular-nums ${up ? "text-good" : down ? "text-bad" : "text-muted"}`}
      title="Change vs the previous period"
    >
      <span aria-hidden>{up ? "▲" : down ? "▼" : "•"}</span>
      <span className="sr-only">{up ? "Up" : down ? "Down" : "No change"} </span>
      {formatChange(value)}
    </span>
  );
}

export function ContentSection({
  label,
  explain,
  aside,
  children,
}: {
  label: ReactNode;
  /** What the numbers mean, in a sentence. */
  explain?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-8 sm:px-[30px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="mono-label m-0">{label}</h2>
          {explain && <p className="m-0 mt-2 max-w-[70ch] text-[0.9rem] text-muted">{explain}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

type Problem = Exclude<SourceResult<unknown>, { status: "ok" }>;

/** "Not connected" or "didn't load" for one source; the rest of the page carries on. */
export function SourceNotice({ result }: { result: Problem }) {
  return (
    <div className="callout" role="note">
      {result.status === "not_connected" ? (
        <>
          <strong>{result.source} isn&apos;t connected.</strong>{" "}
          {result.missing.length ? (
            <>
              Set <code className="font-mono text-[0.85em]">{result.missing.join(", ")}</code> to connect it.
            </>
          ) : (
            "There's no integration for it yet."
          )}{" "}
          Everything else on this page still works.
        </>
      ) : (
        <>
          <strong>{result.source} didn&apos;t load.</strong> {result.message} The rest of the page is unaffected; reload to
          try again.
        </>
      )}
    </div>
  );
}

export function EmptyNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="callout" role="note">
      <strong>{title}</strong> {children}
    </div>
  );
}

/** A row of link chips that set one URL filter. */
export function ChipGroup({ label, options }: { label: string; options: { label: string; href: string; active: boolean }[] }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="mono-label mr-1">{label}</span>
      {options.map((o) => (
        <Link key={o.href + o.label} href={o.href} aria-current={o.active ? "page" : undefined} className="chip" scroll={false}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/** Builds hrefs that change one search param and keep the rest; defaults are left out of the URL. */
export function hrefBuilder(path: string, current: Record<string, string>, defaults: Record<string, string>) {
  return (changes: Record<string, string>) => {
    const merged = { ...current, ...changes };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v && v !== defaults[k]) qs.set(k, v);
    const s = qs.toString();
    return s ? `${path}?${s}` : path;
  };
}

export { Avatar } from "./avatar";

export const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
