/** Pure analytics math for Content OS: totals, changes, chart series, outliers, top posts. */

import { inRange, weekdayIndex, type Bucket, type DayRange } from "./periods";
import type { DailyMetrics, Platform, Post } from "./types";

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Scores each post against its account's median post (views ÷ median views), per platform and
 * author. 3.4 means the post got 3.4× a typical post's views.
 */
export function withOutliers<T extends Post>(posts: T[]): T[] {
  const groups = new Map<string, number[]>();
  const key = (p: Post) => `${p.platform}:${p.author.handle.toLowerCase()}`;
  for (const p of posts) groups.set(key(p), [...(groups.get(key(p)) ?? []), p.metrics.views]);
  return posts.map((p) => {
    const m = median(groups.get(key(p)) ?? []);
    return { ...p, outlier: m ? Math.round((p.metrics.views / m) * 10) / 10 : null };
  });
}

const SUMMED = ["impressions", "engagements", "posts", "likes", "comments", "reposts", "saves", "newFollowers"] as const;
type Summed = (typeof SUMMED)[number];

export interface Totals extends Record<Summed, number> {
  /** Followers at the end of the range (last day that has a count); null without data. */
  followers: number | null;
  /** The day that follower count is from. */
  followersOn: string | null;
  /** Engagements ÷ impressions; null without impressions. */
  engagementRate: number | null;
  /** Which sums had data on at least one day (a 0 from "not reported" isn't a real 0). */
  has: Record<Summed | "followers", boolean>;
}

export function totals(daily: DailyMetrics[], range: DayRange): Totals {
  const days = daily.filter((d) => inRange(d.date, range)).sort((a, b) => a.date.localeCompare(b.date));
  const sums = Object.fromEntries(SUMMED.map((k) => [k, days.reduce((n, d) => n + (d[k] ?? 0), 0)])) as Record<Summed, number>;
  const has = Object.fromEntries(SUMMED.map((k) => [k, days.some((d) => d[k] != null)])) as Record<Summed, boolean>;
  const last = [...days].reverse().find((d) => d.followers != null);
  return {
    ...sums,
    followers: last?.followers ?? null,
    followersOn: last?.date ?? null,
    engagementRate: sums.impressions ? sums.engagements / sums.impressions : null,
    has: { ...has, followers: last != null },
  };
}

/** Adds two platforms' totals (for the Both view). */
export function combine(a: Totals, b: Totals): Totals {
  const sums = Object.fromEntries(SUMMED.map((k) => [k, a[k] + b[k]])) as Record<Summed, number>;
  const has = Object.fromEntries(SUMMED.map((k) => [k, a.has[k] || b.has[k]])) as Record<Summed, boolean>;
  return {
    ...sums,
    followers: a.followers == null && b.followers == null ? null : (a.followers ?? 0) + (b.followers ?? 0),
    followersOn: a.followersOn ?? b.followersOn,
    engagementRate: sums.impressions ? sums.engagements / sums.impressions : null,
    has: { ...has, followers: a.has.followers || b.has.followers },
  };
}

/** Relative change, e.g. 0.12 for +12%. Null when there's no previous value to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

export interface SeriesPoint {
  bucket: Bucket;
  values: Partial<Record<Platform, number>>;
}

/** Impressions per bucket, per platform that has data. */
export function impressionSeries(
  daily: Partial<Record<Platform, DailyMetrics[]>>,
  bucketList: Bucket[],
): SeriesPoint[] {
  return bucketList.map((bucket) => ({
    bucket,
    values: Object.fromEntries(
      Object.entries(daily).map(([platform, days]) => [
        platform,
        days!.filter((d) => inRange(d.date, bucket)).reduce((n, d) => n + d.impressions, 0),
      ]),
    ),
  }));
}

/** The most-viewed posts in the range, across whatever platforms are passed. */
export function topPosts<T extends Post>(posts: T[], range: DayRange, n = 12, dateOf: (p: T) => string): T[] {
  return posts
    .filter((p) => inRange(dateOf(p), range))
    .sort((a, b) => b.metrics.views - a.metrics.views)
    .slice(0, n);
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Average views per post by the day it went out, Monday first. */
export function viewsByWeekday<T extends Post>(posts: T[], dateOf: (p: T) => string) {
  return WEEKDAYS.map((day, i) => {
    const on = posts.filter((p) => weekdayIndex(dateOf(p)) === i);
    return {
      day,
      posts: on.length,
      avgViews: on.length ? Math.round(on.reduce((n, p) => n + p.metrics.views, 0) / on.length) : 0,
    };
  });
}
