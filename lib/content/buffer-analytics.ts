/**
 * Analytics built from Buffer's published posts. Buffer reports each post's lifetime metrics, so a
 * day's numbers are the posts published that day (not views that happened that day). Buffer has no
 * follower counts or bookmarks.
 */

import { localDate } from "@/lib/emails/time";
import { xAvatarUrl } from "@/lib/leads/x-leads";
import { withOutliers } from "./analytics";
import { CREATOR } from "./config";
import type { DailyMetrics, Platform, PlatformAnalytics, Post } from "./types";

export interface SentPostLike {
  id: string;
  platform: Platform;
  text: string;
  sentAt: string;
  url: string | null;
  metrics: Record<string, number>;
}

const m = (p: SentPostLike, key: string) => Math.max(0, Math.round(p.metrics[key] ?? 0));

export function analyticsFromSent(sent: SentPostLike[], platform: Platform, tz: string): PlatformAnalytics {
  const mine = sent.filter((p) => p.platform === platform);
  const posts: Post[] = withOutliers(
    mine.map((p) => ({
      id: `buffer-${p.id}`,
      platform,
      url: p.url ?? (platform === "x" ? CREATOR.x.url : CREATOR.linkedin.url),
      author: {
        name: CREATOR.name,
        handle: CREATOR[platform].handle,
        avatarUrl: platform === "x" ? xAvatarUrl(CREATOR.x.handle) : null,
      },
      text: p.text,
      thread: [],
      quoted: null,
      media: [],
      metrics: { views: m(p, "impressions"), likes: m(p, "reactions"), comments: m(p, "comments"), reposts: m(p, "reposts"), saves: null },
      publishedAt: p.sentAt,
      outlier: null,
    })),
  );

  const byDay = new Map<string, DailyMetrics>();
  for (const p of mine) {
    const date = localDate(new Date(p.sentAt), tz);
    const d = byDay.get(date) ?? {
      date, impressions: 0, engagements: 0, posts: 0, likes: 0, comments: 0, reposts: 0, saves: 0,
      newFollowers: 0, followers: null, repliesSent: 0, repostsSent: 0,
    };
    d.posts += 1;
    d.impressions += m(p, "impressions");
    d.likes += m(p, "reactions");
    d.comments += m(p, "comments");
    d.reposts += m(p, "reposts");
    d.engagements += m(p, "reactions") + m(p, "comments") + m(p, "reposts") + m(p, "clicks");
    byDay.set(date, d);
  }
  return { daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)), posts };
}
