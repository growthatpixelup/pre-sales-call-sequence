import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { localDate } from "@/lib/emails/time";
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

const SUB = "How Daksh's posts on X and LinkedIn are doing: reach, engagement and the posts that carried the period. Numbers come from Buffer: each post's lifetime metrics, counted on the day it went out.";

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
  const top = topPosts(posts, range, 12, dateOf);

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

  let stats: Stat[];
  let tiles: Stat[];
  const perPost = (t: Totals) => (t.posts ? Math.round(t.impressions / t.posts) : 0);
  if (view === "both") {
    const share = (p: Platform) => (c.impressions && cur.get(p) ? Math.round((cur.get(p)!.impressions / c.impressions) * 100) : null);
    stats = [
      {
        label: "Impressions",
        value: formatCompact(c.impressions),
        sub: ok.size === 2 ? `X ${share("x")}% · LinkedIn ${share("linkedin")}%` : `${PLATFORM_LABELS[[...ok.keys()][0]]} only`,
      },
      { label: "Engagement rate", value: formatPct(c.engagementRate), sub: "Engagements ÷ impressions" },
      { label: "Posts", value: formatCompact(c.posts), sub: `In the last ${periodLabel}` },
      { label: "Per post", value: formatCompact(perPost(c)), sub: "Average impressions" },
    ];
    tiles = [
      { label: "Impressions", value: formatCompact(c.impressions), change: change(c.impressions, pv.impressions) },
      { label: "Engagements", value: formatCompact(c.engagements), change: change(c.engagements, pv.engagements) },
      { label: "Posts", value: formatCompact(c.posts), change: change(c.posts, pv.posts) },
      { label: "Per post", value: formatCompact(perPost(c)), change: change(perPost(c), perPost(pv)) },
    ];
  } else {
    stats = [
      { label: "Impressions", value: formatCompact(c.impressions), change: change(c.impressions, pv.impressions) },
      { label: "Engagement rate", value: formatPct(c.engagementRate), change: change(c.engagementRate, pv.engagementRate) },
      { label: view === "x" ? "Likes" : "Reactions", value: formatCompact(c.likes), change: change(c.likes, pv.likes) },
      { label: "Posts", value: formatCompact(c.posts), change: change(c.posts, pv.posts) },
    ];
    tiles = [
      { label: "Engagements", value: formatCompact(c.engagements), change: change(c.engagements, pv.engagements), sub: "Reactions, comments, reposts, clicks" },
      { label: "Comments", value: formatCompact(c.comments), change: change(c.comments, pv.comments) },
      { label: "Reposts", value: formatCompact(c.reposts), change: change(c.reposts, pv.reposts) },
      { label: "Per post", value: formatCompact(perPost(c)), change: change(perPost(c), perPost(pv)), sub: "Average impressions" },
    ];
  }

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
        explain={`Posts published in the last ${periodLabel}, compared with posts published in the ${range.days} days before. Buffer doesn't report followers or bookmarks.`}
      >
        <StatGrid stats={tiles} />
      </ContentSection>

      <ContentSection
        label="Impressions over time"
        explain={`Lifetime impressions of the posts published each ${range.unit}${shown.length > 1 ? ", X and LinkedIn stacked" : ""}.`}
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

