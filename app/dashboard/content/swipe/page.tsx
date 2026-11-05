import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { plural, timeAgo } from "@/lib/content/format";
import { loadSwipes } from "@/lib/content/sources";
import { SWIPE_ORDERS, filterSwipes, swipeStats, type SwipeFilters, type SwipeOrder } from "@/lib/content/swipes";
import { MEDIA_FILTERS, type MediaFilter } from "@/lib/content/types";
import { EmptyNotice, SourceNotice, hrefBuilder, param } from "../_components/kit";
import { SwipeCard } from "./swipe-card";

export const metadata: Metadata = { title: "Swipe · Content OS" };

const TITLE = "The Swipe";
const DEFAULTS = { platform: "both", media: "any", order: "newest" };

const WHERE = [
  { value: "both", label: "Both", dot: null },
  { value: "linkedin", label: "LinkedIn", dot: "bg-series-li" },
  { value: "x", label: "X", dot: "bg-series-x" },
] as const;
const MEDIA_LABELS: Record<MediaFilter, string> = {
  any: "Any",
  images: "With images",
  video: "Video",
  text: "Text only",
  design: "Design",
};
const ORDER_LABELS: Record<SwipeOrder, string> = { newest: "Newest first", outlier: "Biggest outlier" };

export default function SwipePage({ searchParams }: PageProps<"/dashboard/content/swipe">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <SwipeView searchParams={searchParams} />
    </Suspense>
  );
}

async function SwipeView({ searchParams }: { searchParams: PageProps<"/dashboard/content/swipe">["searchParams"] }) {
  const sp = await searchParams;
  // "Synced 3h ago" depends on the current time.
  await connection();
  const now = currentTime();
  const p = param(sp.platform);
  const m = param(sp.media);
  const o = param(sp.order);
  const result = await loadSwipes();
  const filters: SwipeFilters = {
    platform: p === "x" || p === "linkedin" ? p : "both",
    pillar: "all",
    media: MEDIA_FILTERS.includes(m as MediaFilter) ? (m as MediaFilter) : "any",
    order: SWIPE_ORDERS.some((x) => x.value === o) ? (o as SwipeOrder) : "newest",
  };

  if (result.status !== "ok") {
    return (
      <>
        <Header />
        <div className="px-4 py-8 sm:px-[30px]">
          <SourceNotice result={result} />
        </div>
      </>
    );
  }

  const { swipes, runs } = result.data;
  const stats = swipeStats(swipes, runs);
  const shown = filterSwipes(swipes, filters);
  const lastRunFailed = stats.lastRun?.status === "failed" && stats.lastRun.id !== stats.lastSync?.id;
  const href = hrefBuilder("/dashboard/content/swipe", { platform: filters.platform, media: filters.media, order: filters.order }, DEFAULTS);

  const sync = (
    <p className="m-0 text-[0.95rem] text-muted">
      {stats.lastSync?.finishedAt ? `synced ${timeAgo(stats.lastSync.finishedAt, now)}` : "not synced yet"} ·{" "}
      {plural(stats.count, "swipe")} from {plural(stats.accounts, "account")}
      {lastRunFailed && stats.lastRun && (
        <span className="block text-right text-[0.85rem] text-bad">
          Last sync failed {timeAgo(stats.lastRun.startedAt, now)}
          {stats.lastRun.error ? `: ${stats.lastRun.error}` : ""}
        </span>
      )}
    </p>
  );

  return (
    <>
      <Header aside={sync} />

      <nav aria-label="Filters" className="mx-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line py-6 sm:mx-[30px]">
        <Group label="Where">
          {WHERE.map((w) => (
            <Pill key={w.value} href={href({ platform: w.value })} active={filters.platform === w.value}>
              {w.dot && <span aria-hidden className={`size-2 ${w.dot}`} />}
              {w.label}
            </Pill>
          ))}
        </Group>
        <Group label="Media">
          {MEDIA_FILTERS.map((x) => (
            <Pill key={x} href={href({ media: x })} active={filters.media === x}>
              {MEDIA_LABELS[x]}
            </Pill>
          ))}
        </Group>
        <Group label="Order">
          {SWIPE_ORDERS.map((x) => (
            <Pill key={x.value} href={href({ order: x.value })} active={filters.order === x.value}>
              {ORDER_LABELS[x.value]}
            </Pill>
          ))}
        </Group>
        <span className="ml-auto text-[0.95rem] text-muted tabular-nums" aria-live="polite">
          {shown.length} shown
        </span>
      </nav>

      <div className="px-4 py-6 sm:px-[30px]">
        {!swipes.length ? (
          <EmptyNotice title="No swipes yet.">
            Bookmark posts on X or save them on LinkedIn; they show up here after the bot&apos;s next sync.
          </EmptyNotice>
        ) : !shown.length ? (
          <EmptyNotice title="Nothing matches these filters.">
            <Link href="/dashboard/content/swipe" className="link">
              Clear the filters
            </Link>
          </EmptyNotice>
        ) : (
          <div className="columns-1 gap-4 md:columns-2 xl:columns-3 2xl:columns-4">
            {shown.map((s) => (
              <SwipeCard key={s.id} swipe={s} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Kept outside the component because it reads the clock. */
function currentTime() {
  return Date.now();
}

function Header({ aside }: { aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-10 gap-y-3 px-4 pt-10 pb-2 sm:px-[30px]">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h1 className="h1 m-0 whitespace-nowrap">{TITLE}</h1>
      </div>
      {aside}
    </header>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="mono-label mr-2">{label}</span>
      {children}
    </div>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="pill" scroll={false}>
      {children}
    </Link>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading swipe file">
      <Header />
      <div className="columns-1 gap-4 px-4 py-6 sm:px-[30px] md:columns-2 xl:columns-3 2xl:columns-4">
        {[72, 96, 56, 80].map((h, i) => (
          <div key={i} className="skeleton mb-4" style={{ height: `${h * 4}px` }} />
        ))}
      </div>
    </div>
  );
}
