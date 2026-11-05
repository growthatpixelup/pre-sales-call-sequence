/**
 * One platform's analytics, merged from every source we have, best first:
 *  1. The platform's own export (migration 014): true daily numbers, followers, full post metrics.
 *  2. Buffer: each published post's lifetime metrics, counted on its publish day. Used for days
 *     after the latest export, and for posts the export doesn't list.
 *  3. Typefully: published posts with text and link but no metrics, so post counts are complete.
 */

import { localDate } from "@/lib/emails/time";
import { xAvatarUrl } from "@/lib/leads/x-leads";
import { withOutliers } from "./analytics";
import { CREATOR } from "./config";
import type { DailyRow, PostRow } from "./imports";
import { linkedinPostId } from "./linkedin-export";
import type { DailyMetrics, Platform, PlatformAnalytics, Post } from "./types";
import type { XEmbed } from "./x-embed";

export interface SentPostLike {
  id: string;
  platform: Platform;
  text: string;
  sentAt: string;
  url: string | null;
  metrics: Record<string, number>;
}

export interface PublishedPostLike {
  platform: Platform;
  text: string;
  at: string;
  url: string | null;
}

export interface Sources {
  buffer?: SentPostLike[];
  imported?: { daily: DailyRow[]; posts: PostRow[] };
  typefully?: PublishedPostLike[];
  /** X only: public likes, replies, text and media per post id (x-embed.ts). */
  embeds?: Map<string, XEmbed>;
}

/** The id in a post URL, so the same post from two sources merges. */
export function postKey(platform: Platform, url: string | null | undefined): string | null {
  if (!url) return null;
  return platform === "x" ? (/status\/(\d+)/.exec(url)?.[1] ?? null) : linkedinPostId(url);
}

/** Empty, or a preview / URL slug that was cut short. */
const truncated = (t: string) => !t || /(…|\.\.\.)$/.test(t);

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (ymd: string) => fmt.format(new Date(`${ymd}T12:00:00Z`));

export function buildAnalytics(platform: Platform, src: Sources, tz: string): PlatformAnalytics {
  const author = {
    name: CREATOR.name,
    handle: CREATOR[platform].handle,
    avatarUrl: platform === "x" ? xAvatarUrl(CREATOR.x.handle) : null,
  };
  const sources: string[] = [];

  // ---- Posts: imported > Buffer > Typefully, merged on the id in the URL (else publish time + text).
  const posts = new Map<string, Post>();
  const keyFor = (url: string | null, at: string, text: string) =>
    postKey(platform, url) ?? `${localDate(new Date(at), tz)}:${text.slice(0, 40).toLowerCase()}`;
  const add = (key: string, post: Post, fillOnly: boolean) => {
    const prev = posts.get(key);
    if (!prev) return void posts.set(key, post);
    if (fillOnly) {
      // Lower-priority source: only fill what's missing (a fuller text than a slug or preview, a link).
      if (truncated(prev.text) && post.text.length > prev.text.replace(/(…|\.\.\.)$/, "").length) prev.text = post.text;
      if (!prev.url && post.url) prev.url = post.url;
      return;
    }
    posts.set(key, post);
  };

  const imported = src.imported?.posts.filter((p) => p.platform === platform) ?? [];
  for (const p of imported) {
    add(
      keyFor(p.url, p.published_at, p.text ?? ""),
      {
        id: `${platform}-${p.post_id}`,
        platform,
        url: p.url,
        author,
        text: p.text ?? "",
        thread: [],
        quoted: null,
        media: [],
        metrics: {
          views: p.impressions ?? 0,
          likes: p.likes,
          comments: p.comments,
          reposts: p.reposts,
          saves: p.saves,
          engagements: p.engagements,
        },
        publishedAt: p.published_at,
        outlier: null,
      },
      false,
    );
  }
  const n = (p: SentPostLike, k: string) => Math.max(0, Math.round(p.metrics[k] ?? 0));
  const buffer = src.buffer?.filter((p) => p.platform === platform) ?? [];
  for (const p of buffer) {
    const key = keyFor(p.url, p.sentAt, p.text);
    const post: Post = {
      id: `buffer-${p.id}`,
      platform,
      url: p.url ?? CREATOR[platform].url,
      author,
      text: p.text,
      thread: [],
      quoted: null,
      media: [],
      metrics: { views: n(p, "impressions"), likes: n(p, "reactions"), comments: n(p, "comments"), reposts: n(p, "reposts"), saves: null },
      publishedAt: p.sentAt,
      outlier: null,
    };
    if (posts.has(key)) add(key, post, true);
    else posts.set(key, post);
  }
  const typefully = src.typefully?.filter((p) => p.platform === platform) ?? [];
  let typefullyOnly = 0;
  /** Posts no source has impressions for (a 0 from Buffer is a real, just-published 0). */
  const noImpressions = new Set(imported.filter((p) => p.impressions == null).map((p) => `${platform}-${p.post_id}`));
  for (const p of typefully) {
    const key = keyFor(p.url, p.at, p.text);
    if (posts.has(key)) add(key, { ...posts.get(key)!, text: p.text, url: p.url ?? posts.get(key)!.url }, true);
    else {
      typefullyOnly++;
      noImpressions.add(`typefully-${key}`);
      posts.set(key, {
        id: `typefully-${key}`,
        platform,
        url: p.url ?? CREATOR[platform].url,
        author,
        text: p.text,
        thread: [],
        quoted: null,
        media: [],
        metrics: { views: 0, likes: null, comments: null, reposts: null, saves: null },
        publishedAt: p.at,
        outlier: null,
      });
    }
  }
  // X: fill likes, replies, full text and media from the public embed, where other sources lack them.
  let embedded = 0;
  const embedOnly = new Set<string>();
  if (platform === "x" && src.embeds?.size) {
    for (const [key, p] of posts) {
      const e = src.embeds.get(key);
      if (!e) continue;
      embedded++;
      const hadNumbers = p.metrics.likes != null;
      if (!hadNumbers) {
        p.metrics.likes = e.likes;
        p.metrics.comments = e.replies;
        embedOnly.add(p.id);
      }
      if (e.text && (truncated(p.text) || e.text.length > p.text.length)) p.text = e.text;
      if (!p.media.length && e.media.length) p.media = e.media;
    }
  }
  const allPosts = [...posts.values()];
  // Outliers only among posts that have numbers.
  const measured = withOutliers(allPosts.filter((p) => p.metrics.views > 0));
  const scored = new Map(measured.map((p) => [p.id, p.outlier]));
  for (const p of allPosts) p.outlier = scored.get(p.id) ?? null;

  // ---- Daily: imported days are the truth; after the last imported day, Buffer by publish day.
  const importedDays = src.imported?.daily.filter((d) => d.platform === platform) ?? [];
  // Only days with impression totals count as covered; a row with just a follower count (e.g. the
  // Grok bot's daily snapshot) adds followers without hiding Buffer's numbers for that day.
  const withTotals = importedDays.filter((d) => d.impressions > 0 || d.engagements > 0);
  const coveredTo = withTotals.reduce<string | null>((max, d) => (!max || d.date > max ? d.date : max), null);
  const coveredFrom = withTotals.reduce<string | null>((min, d) => (!min || d.date < min ? d.date : min), null);
  const daily = new Map<string, DailyMetrics>();
  const blank = (date: string): DailyMetrics => ({
    date, impressions: 0, engagements: 0, posts: 0, likes: null, comments: null, reposts: null, saves: null, newFollowers: null, followers: null,
  });
  for (const d of withTotals) {
    daily.set(d.date, {
      date: d.date,
      impressions: d.impressions,
      engagements: d.engagements,
      posts: 0,
      likes: d.likes,
      comments: d.comments,
      reposts: d.reposts,
      saves: d.saves,
      newFollowers: d.new_followers,
      followers: d.followers,
    });
  }
  for (const p of buffer) {
    const date = localDate(new Date(p.sentAt), tz);
    if (coveredTo && date <= coveredTo && (!coveredFrom || date >= coveredFrom)) continue;
    const d = daily.get(date) ?? blank(date);
    d.impressions += n(p, "impressions");
    d.engagements += n(p, "reactions") + n(p, "comments") + n(p, "reposts") + n(p, "clicks");
    d.likes = (d.likes ?? 0) + n(p, "reactions");
    d.comments = (d.comments ?? 0) + n(p, "comments");
    d.reposts = (d.reposts ?? 0) + n(p, "reposts");
    daily.set(date, d);
  }
  for (const d of importedDays) {
    if (withTotals.includes(d)) continue;
    const row = daily.get(d.date) ?? blank(d.date);
    if (d.followers != null) row.followers = d.followers;
    if (d.new_followers != null) row.newFollowers = d.new_followers;
    daily.set(d.date, row);
  }
  // Post counts from the merged list, whatever the day's numbers came from. Likes and replies that
  // only the embed knows go on the publish day too (not into engagements: there are no impressions).
  for (const p of allPosts) {
    const date = localDate(new Date(p.publishedAt), tz);
    const d = daily.get(date) ?? blank(date);
    d.posts += 1;
    if (embedOnly.has(p.id)) {
      d.likes = (d.likes ?? 0) + (p.metrics.likes ?? 0);
      d.comments = (d.comments ?? 0) + (p.metrics.comments ?? 0);
    }
    daily.set(date, d);
  }

  const name = platform === "x" ? "X" : "LinkedIn";
  const firstBuffer = buffer.reduce<string | null>((min, p) => {
    const d = localDate(new Date(p.sentAt), tz);
    return !min || d < min ? d : min;
  }, null);
  if (coveredFrom && coveredTo) sources.push(`${name}: daily impressions, engagements and followers from ${name}'s export, ${day(coveredFrom)} – ${day(coveredTo)}.`);
  if (buffer.length) {
    sources.push(
      coveredTo
        ? `${name}: after ${day(coveredTo)}, impressions from Buffer (each post's lifetime views, on its publish day).`
        : `${name}: impressions from Buffer since ${day(firstBuffer!)} (each post's lifetime views, on its publish day).`,
    );
  }
  if (typefullyOnly) sources.push(`${name}: ${typefullyOnly} more posts from Typefully${platform === "x" && embedded ? ", with likes and replies but no impressions" : ", counted without numbers"}.`);
  if (platform === "x" && embedded) sources.push(`X: likes, replies, text and media for ${embedded} posts from X's public embed.`);

  // From when impressions are complete: the first day with data, moved past the last post that has
  // none (outside days an export covers, where daily totals don't depend on posts). Comparing with a
  // period before this would compare with missing numbers.
  const first = [coveredFrom, firstBuffer].filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const lastGap = allPosts
    .filter((p) => noImpressions.has(p.id))
    .map((p) => localDate(new Date(p.publishedAt), tz))
    .filter((d) => !(coveredFrom && coveredTo && d >= coveredFrom && d <= coveredTo))
    .sort()
    .at(-1);
  const afterGap = lastGap ? new Date(Date.parse(`${lastGap}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null;
  const since = first && afterGap && afterGap > first ? afterGap : first;
  if (since && first && since > first) {
    sources.push(`${name}: impressions are complete from ${day(since)}; earlier posts are missing some.`);
  }

  return { daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), posts: allPosts, sources, since };
}

/** Buffer only (kept for callers and tests that have nothing else). */
export function analyticsFromSent(sent: SentPostLike[], platform: Platform, tz: string): PlatformAnalytics {
  return buildAnalytics(platform, { buffer: sent }, tz);
}
