import Link from "next/link";
import type { ReactNode } from "react";

/** Two-column page: a fixed info rail on the left, the work on the right. */
export function Page({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <aside className="rail">{rail}</aside>
      <div className="main">{children}</div>
    </div>
  );
}

/** Title and sub-copy at the top of the rail. */
export function RailIntro({
  title,
  sub,
  back,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** A link back up the hierarchy, shown above the title. */
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="rail-intro">
      {back && (
        <Link href={back.href} className="mono-label back">
          ← {back.label}
        </Link>
      )}
      <h1 className="h1">{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  );
}

/** Label/value rows. `flush` drops the side padding for use inside sections. */
export function Rows({
  rows,
  flush = false,
  wide = false,
}: {
  rows: [label: ReactNode, value: ReactNode][];
  flush?: boolean;
  /** A 220px label column, for long question labels. */
  wide?: boolean;
}) {
  return (
    <dl className={`rows ${flush ? "rows-flush" : ""} ${wide ? "rows-wide" : ""}`}>
      {rows.map(([label, value], i) => (
        <div key={i}>
          <dt>{label}</dt>
          <dd>{value ?? <None />}</dd>
        </div>
      ))}
    </dl>
  );
}

/** CTAs pinned to the bottom of the rail. */
export function RailActions({ children }: { children: ReactNode }) {
  return <div className="rail-actions">{children}</div>;
}

/** A main-column section: label on the left, body on the right. `wide` stacks them for tables. */
export function Section({
  label,
  aside,
  wide = false,
  children,
}: {
  label: ReactNode;
  /** Extra content under the label, such as a small action. */
  aside?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`section ${wide ? "section-wide" : ""}`}>
      <div className={wide ? "flex flex-wrap items-center justify-between gap-3" : "section-head"}>
        <h2 className="mono-label m-0">{label}</h2>
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function Callout({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <div className="callout" role="note">
      {title && <strong>{title}</strong>} {children}
    </div>
  );
}

export type Tone = "accent" | "neutral" | "muted";

export function Tag({ tone = "accent", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="tag" data-tone={tone}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 py-2 text-muted">{children}</p>;
}

export function None() {
  return <span className="text-hint">—</span>;
}

/** Skeleton for a page while its data loads. */
export function PageSkeleton({ title, sub, label }: { title: string; sub?: string; label: string }) {
  return (
    <Page rail={<RailIntro title={title} sub={sub} />}>
      <div className="space-y-px pt-7" aria-busy="true" aria-label={label}>
        <div className="skeleton h-28" />
        <div className="skeleton h-56" />
        <div className="skeleton h-72" />
      </div>
    </Page>
  );
}

const ICONS = {
  external: <path d="M7 17 17 7M8 7h9v9" />,
  next: <path d="m9 6 6 6-6 6" />,
  copy: (
    <>
      <path d="M9 9h11v11H9z" />
      <path d="M5 15H4V4h11v1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  send: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />,
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}
