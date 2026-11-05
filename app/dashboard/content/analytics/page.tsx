import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { localDate } from "@/lib/emails/time";
import { formatYmd } from "@/lib/format";
import { change, combine, impressionSeries, topPosts, totals, viewsByWeekday, type Totals } from "@/lib/content/analytics";
import { TOOLS } from "@/lib/content/config";
import { formatCompact, formatPct, plural } from "@/lib/content/format";
import { PERIODS, DEFAULT_PERIOD, buckets, parsePeriod, resolvePeriod } from "@/lib/content/periods";
import { loadAnalytics, timeZone } from "@/lib/content/sources";
import { PLATFORMS, PLATFORM_LABELS, type Platform, type PlatformAnalytics, type Post, type SourceResult } from "@/lib/content/types";
import { BarChart, type ChartSeries } from "../_components/bar-chart";
import {
  ChipGroup,
  ContentHeader,
  ContentSection,
  EmptyNotice,
  SourceNotice,
  StatGrid,
  hrefBuilder,
  param,
  type Stat,
} from "../_components/kit";
import { PostCard } from "../_components/post-card";

export const metadata: Metadata = { title: "Analytics · Content OS" };

const VIEWS = [
  { value: "both", label: "Both" },
  { value: "x", label: "X" },
  { value: "linkedin", label: "LinkedIn" },
] as const;
type View = (typeof VIEWS)[number]["value"];

const SERIES: Record<Platform, ChartSeries> = {
  x: { label: "X", colorClass: "bg-series-x" },
  linkedin: { label: "LinkedIn", colorClass: "bg-series-li" },
};

const SUB = "How Daksh's posts on X and LinkedIn are doing: reach, engagement, followers and the posts that carried the period.";

export default function AnalyticsPage({ searchParams }: PageProps<"/dashboard/content/analytics">) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Analytics searchParams={searchParams} />
    </Suspense>
  );
}

async function Analytics({ searchParams }: { searchParams: PageProps<"/dashboard/content/analytics">["searchParams"] }) {
  const sp = await searchParams;
  // The period ends today.
  await connection();
  const view: View = VIEWS.some((v) => v.value === param(sp.platform)) ? (param(sp.platform) as View) : "both";
  const period = parsePeriod(param(sp.period));
  const tz = timeZone();
  const range = resolvePeriod(period, localDate(new Date(), tz));

  const platforms: Platform[] = view === "both" ? [...PLATFORMS] : [view];
  const results = await Promise.all(platforms.map((p) => loadAnalytics(p)));
  const byPlatform = new Map(platforms.map((p, i) => [p, results[i]] as const));
  const ok = new Map(
    platforms.flatMap((p) => {
      const r = byPlatform.get(p)!;
      return r.status === "ok" ? [[p, r.data] as const] : [];
    }),
  );
  const problems = results.filter((r): r is Exclude<SourceResult<PlatformAnalytics>, { status: "ok" }> => r.status !== "ok");

  const href = hrefBuilder("/dashboard/content/analytics", { platform: view, period }, { platform: "both", period: DEFAULT_PERIOD });
  const filters = (
    <>
      <ChipGroup
        label="Platform"
        options={VIEWS.map((v) => ({ label: v.label, href: href({ platform: v.value }), active: view === v.value }))}
      />
      <ChipGroup
        label="Period"
        options={PERIODS.map((p) => ({ label: p.label, href: href({ period: p.value }), active: period === p.value }))}
      />
    </>
  );
  const links =
    view === "x"
      ? [TOOLS.xAnalytics]
      : view === "linkedin"
        ? [TOOLS.linkedinAnalytics]
        : [TOOLS.xAnalytics, TOOLS.linkedinAnalytics];

  const dateOf = (p: Post) => localDate(new Date(p.publishedAt), tz);
  const cur = new Map([...ok].map(([p, d]) => [p, totals(d.daily, range)]));
  const prev = new Map([...ok].map(([p, d]) => [p, totals(d.daily, range.previous)]));
  const sum = (m: Map<Platform, Totals>) => [...m.values()].reduce((a, b) => combine(a, b));
  const posts = [...ok.values()].flatMap((d) => d.posts);
  const top = topPosts(posts.filter((p) => p.metrics.views > 0), range, 12, dateOf);

  const header = (stats: Stat[]) => (
    <ContentHeader title="Analytics" sub={SUB} stats={stats} links={links}>
      {filters}
    </ContentHeader>
  );

  if (!ok.size) {
    return (
      <>
        {header([])}
        <ContentSection label="Sources">
          <div className="grid gap-3">
            {problems.map((p) => (
              <SourceNotice key={p.source} result={p} />
            ))}
          </div>
        </ContentSection>
      </>
    );
  }

  const c = sum(cur);
  const pv = sum(prev);
  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase();

  // Compare only when every source covers the previous period; otherwise the arrow compares with nothing.
  const latestSince = [...ok.values()].map((d) => d.since).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const comparable = [...ok.values()].every((d) => d.since != null && d.since <= range.previous.from);
  const ch = (a: number | null, b: number | null) => (comparable ? change(a, b) : null);
  const followerPlatforms = platforms.filter((p) => cur.get(p)?.has.newFollowers).map((p) => PLATFORM_LABELS[p]);
  const onlySome = followerPlatforms.length > 0 && followerPlatforms.length < ok.size;

  const perPost = (t: Totals) => (t.posts ? Math.round(t.impressions / t.posts) : 0);
  const followers: Stat | null = c.has.followers
    ? {
        label: "Followers",
        value: formatCompact(c.followers ?? 0),
        change: ch(c.followers, pv.followers),
        sub: c.followersOn && c.followersOn < range.to ? `As of ${formatYmd(c.followersOn)}` : undefined,
      }
    : null;
  const newFollowers: Stat | null = c.has.newFollowers
    ? {
        label: "New followers",
        value: `+${formatCompact(c.newFollowers)}`,
        change: ch(c.newFollowers, pv.newFollowers),
        sub: onlySome ? `${followerPlatforms.join(", ")} only` : undefined,
      }
    : null;
  const tile = (label: string, key: "likes" | "comments" | "reposts" | "saves", sub?: string): Stat | null =>
    c.has[key] ? { label, value: formatCompact(c[key]), change: ch(c[key], pv[key]), sub } : null;
  const pick = (list: (Stat | null)[], n = 4) => list.filter((x): x is Stat => x != null).slice(0, n);

  let stats: Stat[];
  let tiles: Stat[];
  if (view === "both") {
    const share = (p: Platform) => (c.impressions && cur.get(p) ? Math.round((cur.get(p)!.impressions / c.impressions) * 100) : null);
    stats = pick([
      {
        label: "Impressions",
        value: formatCompact(c.impressions),
        sub: ok.size === 2 ? `X ${share("x")}% · LinkedIn ${share("linkedin")}%` : `${PLATFORM_LABELS[[...ok.keys()][0]]} only`,
      },
      { label: "Engagement rate", value: formatPct(c.engagementRate), sub: "Engagements ÷ impressions" },
      { label: "Posts", value: formatCompact(c.posts), sub: `In the last ${periodLabel}` },
      newFollowers ? { ...newFollowers, label: "Follower growth", change: undefined } : null,
      { label: "Per post", value: formatCompact(perPost(c)), sub: "Average impressions" },
    ]);
    tiles = pick([
      { label: "Impressions", value: formatCompact(c.impressions), change: ch(c.impressions, pv.impressions) },
      { label: "Engagements", value: formatCompact(c.engagements), change: ch(c.engagements, pv.engagements) },
      { label: "Posts", value: formatCompact(c.posts), change: ch(c.posts, pv.posts) },
      newFollowers,
      { label: "Per post", value: formatCompact(perPost(c)), change: ch(perPost(c), perPost(pv)) },
    ]);
  } else {
    stats = pick([
      { label: "Impressions", value: formatCompact(c.impressions), change: ch(c.impressions, pv.impressions) },
      { label: "Engagement rate", value: formatPct(c.engagementRate), change: ch(c.engagementRate, pv.engagementRate) },
      followers,
      tile(view === "x" ? "Likes" : "Reactions", "likes"),
      { label: "Posts", value: formatCompact(c.posts), change: ch(c.posts, pv.posts) },
    ]);
    tiles = pick(
      [
        { label: "Engagements", value: formatCompact(c.engagements), change: ch(c.engagements, pv.engagements) },
        newFollowers,
        view === "x" ? tile("Bookmarks", "saves") : null,
        tile("Comments", "comments"),
        tile("Reposts", "reposts"),
        { label: "Per post", value: formatCompact(perPost(c)), change: ch(perPost(c), perPost(pv)), sub: "Average impressions" },
      ],
      8,
    );
  }
  const sourceLines = [...new Set([...ok.entries()].flatMap(([, d]) => d.sources))];

  const shown = platforms.filter((p) => ok.has(p));
  const series = impressionSeries(Object.fromEntries(shown.map((p) => [p, ok.get(p)!.daily])), buckets(range, range.unit));
  const points = series.map((s) => ({ label: s.bucket.label, values: shown.map((p) => s.values[p] ?? 0) }));
  const unitWord = range.unit === "day" ? "Day" : range.unit === "week" ? "Week of" : "Month";
  const inPeriod = posts.filter((p) => dateOf(p) >= range.from && dateOf(p) <= range.to);

  return (
    <>
      {header(stats)}

      {problems.length > 0 && (
        <ContentSection label="Sources">
          <div className="grid gap-3">
            {problems.map((p) => (
              <SourceNotice key={p.source} result={p} />
            ))}
          </div>
        </ContentSection>
      )}

      <ContentSection
        label="Change vs previous period"
        explain={
          comparable
            ? `The last ${periodLabel}, compared with the ${range.days} days before.`
            : `The last ${periodLabel}. No comparison: the data starts ${latestSince ? formatYmd(latestSince) : "later"}, after the ${range.days} days before this began. Pick a shorter period, or import an older export.`
        }
      >
        <StatGrid stats={tiles} />
        {sourceLines.length > 0 && (
          <ul className="m-0 mt-4 grid gap-1 p-0 text-[0.82rem] text-muted list-none">
            {sourceLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
      </ContentSection>

      <ContentSection
        label="Impressions over time"
        explain={`Impressions per ${range.unit}${shown.length > 1 ? ", X and LinkedIn stacked" : ""}. Days from an export count views that day; later days count each post's lifetime views on its publish day.`}
      >
        {c.impressions ? (
          <BarChart points={points} series={shown.map((p) => SERIES[p])} measure="Impressions" firstColumn={unitWord} />
        ) : (
          <EmptyNotice title="Nothing in this period.">No impressions recorded; try a longer period.</EmptyNotice>
        )}
      </ContentSection>

      {view === "linkedin" && (
        <ContentSection
          label="Best posting day"
          explain={`Average impressions per post by the day it went out, across ${plural(inPeriod.length, "post")} in this period.`}
        >
          {inPeriod.length ? (
            <BarChart
              points={viewsByWeekday(inPeriod, dateOf).map((d) => ({ label: d.day, values: [d.avgViews] }))}
              series={[{ label: "Avg. impressions per post", colorClass: "bg-series-li" }]}
              measure="Avg. impressions per post"
              firstColumn="Day"
            />
          ) : (
            <EmptyNotice title="Nothing in this period.">No LinkedIn posts went out.</EmptyNotice>
          )}
        </ContentSection>
      )}

      <ContentSection
        label={`Top posts · ${top.length}`}
        explain="Most-viewed posts in the period. The badge compares each post's views with the account's median post (2x = twice a typical post)."
      >
        {top.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {top.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        ) : (
          <EmptyNotice title="Nothing in this period.">No posts went out in the last {periodLabel}.</EmptyNotice>
        )}
      </ContentSection>
    </>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading analytics">
      <ContentHeader title="Analytics" sub={SUB} stats={[]} />
      <div className="grid gap-px px-4 py-8 sm:px-[30px]">
        <div className="skeleton h-28" />
        <div className="skeleton h-64" />
        <div className="skeleton h-96" />
      </div>
    </div>
  );
}

