import "server-only";

import { dashboardTimeZone } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
import { xAvatarUrl } from "@/lib/leads/x-leads";
import { NotConnected } from "./errors";
import type { PhotoView } from "./photo-library";
import { readPhotos } from "./photos";
import { readTypefullyPublished } from "./schedulers/typefully";
import { buildAnalytics, postKey } from "./buffer-analytics";
import { readXEmbeds } from "./x-embed";
import type { DailyRow, PostRow } from "./imports";
import { readBuffer, readBufferSent } from "./schedulers/buffer";
import { readTypefully } from "./schedulers/typefully";
import {
  PLATFORM_LABELS,
  SCHEDULER_LABELS,
  type Media,
  type Platform,
  type PlatformAnalytics,
  type ScheduledPost,
  type Scheduler,
  type SourceResult,
  type Swipe,
  type SwipeFile,
  type SwipeRun,
} from "./types";

/**
 * Content OS data layer. Every page reads through these functions and gets a SourceResult back,
 * so one source failing or not being connected never takes a page down. There is no sample
 * data: a source without credentials says so.
 */

async function load<T>(label: string, read: () => Promise<T>): Promise<SourceResult<T>> {
  try {
    return { status: "ok", data: await read() };
  } catch (e) {
    if (e instanceof NotConnected) return { status: "not_connected", source: label, missing: e.missing };
    return { status: "error", source: label, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Content OS days and slot times: DASHBOARD_TIMEZONE, else Daksh's own (his Typefully queue is in
 * India time). Never the server's zone, which is UTC on Vercel.
 */
export const timeZone = () => (process.env.DASHBOARD_TIMEZONE?.trim() ? dashboardTimeZone() : "Asia/Kolkata");

/**
 * One platform's numbers and posts, merged from the platform's own export (migration 014), Buffer's
 * per-post metrics, and Typefully's published posts (see buffer-analytics.ts). Any one source can be
 * missing; the page lists the ones that answered.
 */
export function loadAnalytics(platform: Platform): Promise<SourceResult<PlatformAnalytics>> {
  return load(`${PLATFORM_LABELS[platform]} analytics`, async () => {
    const [buffer, imported, typefully] = await Promise.allSettled([readBufferSent(), readImported(platform), readTypefullyPublished()]);
    const value = <T>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : undefined);
    if ([buffer, imported, typefully].every((r) => r.status === "rejected")) {
      throw (buffer as PromiseRejectedResult).reason;
    }
    const src = { buffer: value(buffer), imported: value(imported) ?? undefined, typefully: value(typefully) };
    // X: public likes/replies/media for every post we know, by the id in its link.
    const embeds =
      platform === "x"
        ? await readXEmbeds(
            [...(src.buffer ?? []).filter((p) => p.platform === "x").map((p) => p.url), ...(src.typefully ?? []).filter((p) => p.platform === "x").map((p) => p.url), ...(src.imported?.posts ?? []).map((p) => p.url)]
              .map((u) => postKey("x", u))
              .filter((k): k is string => Boolean(k)),
          )
        : undefined;
    const data = buildAnalytics(platform, { ...src, embeds }, timeZone());
    if (!data.daily.length && !data.posts.length) throw new NotConnected(["an analytics export (scripts/import-analytics-export.mts)"]);
    return data;
  });
}

/** The platform's imported export rows, or null before migration 014 / any import. */
async function readImported(platform: Platform): Promise<{ daily: DailyRow[]; posts: PostRow[] } | null> {
  const db = supabase();
  const [daily, posts] = await Promise.all([
    db.from("content_daily").select("*").eq("platform", platform).order("date").limit(5000),
    db.from("content_posts").select("*").eq("platform", platform).order("published_at", { ascending: false }).limit(5000),
  ]);
  if (daily.error || posts.error) return null;
  return { daily: daily.data as DailyRow[], posts: posts.data as PostRow[] };
}

/** Everything one scheduler holds from 3 weeks back to 3 weeks ahead: published, queued, planned, drafts, failed. */
export function loadScheduler(scheduler: Scheduler, now: Date): Promise<SourceResult<ScheduledPost[]>> {
  return load(SCHEDULER_LABELS[scheduler], () => (scheduler === "typefully" ? readTypefully(now) : readBuffer(now)));
}

/** The swipe file and its sync history, written by the Grok bot. */
export function loadSwipes(): Promise<SourceResult<SwipeFile>> {
  return load("Swipe file", readSwipes);
}

/** Photo library: table `photos` and Storage bucket `photos` (migration 015). */
export function loadPhotos(): Promise<SourceResult<PhotoView[]>> {
  return load("Photo library", readPhotos);
}

// ---------- Supabase: tables `swipes` and `swipe_runs` (migration 013, contract in docs/content-os.md) ----------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str(obj(x).text))).filter((x): x is string => Boolean(x)) : [];
/** The bot may write snake_case or camelCase keys inside jsonb; accept either. */
const pickKey = (o: Json, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v != null);

/**
 * The person's profile picture: what the bot saved, else (on X) their current picture by handle.
 * LinkedIn has no lookup by handle, so it relies on the bot saving one.
 */
function avatarFor(platform: Platform, saved: string | null, handle: string | null): string | null {
  // X serves 48px "_normal" pictures by default; ask for 200px so they stay sharp.
  if (saved) return saved.replace(/_normal(\.\w+)$/, "_200x200$1");
  const h = handle?.replace(/^@/, "").trim();
  return platform === "x" && h && /^[A-Za-z0-9_]{1,15}$/.test(h) ? xAvatarUrl(h) : null;
}

const isImageUrl = (url: string) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || /\/(tweet_video_thumb|amplify_video_thumb|ext_tw_video_thumb)\//.test(url);

export interface SwipeRow {
  id: string;
  platform: Platform;
  url: string;
  author_name: string | null;
  author_handle: string | null;
  author_avatar_url: string | null;
  text: string | null;
  thread: unknown;
  quoted: unknown;
  media: unknown;
  metrics: unknown;
  outlier_score: number | string | null;
  analysis: unknown;
  pillar: string | null;
  hook_pattern: string | null;
  posted_at: string | null;
  bookmarked_at: string | null;
  first_seen_at: string;
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: SwipeRun["trigger"];
  status: SwipeRun["status"];
  fetched: number | null;
  inserted: number | null;
  updated: number | null;
  failed: number | null;
  error: string | null;
}

export function fromSwipeRow(r: SwipeRow): Swipe {
  const metrics = obj(r.metrics);
  const quoted = obj(r.quoted);
  const quotedAuthor = obj(quoted.author);
  const quotedText = str(quoted.text);
  const a = obj(r.analysis);
  const hook = str(a.hook);
  const confidence = str(a.confidence);
  return {
    id: r.id,
    platform: r.platform,
    url: r.url,
    author: {
      name: r.author_name ?? r.author_handle ?? "Unknown",
      handle: r.author_handle ?? "",
      avatarUrl: avatarFor(r.platform, r.author_avatar_url, r.author_handle),
    },
    text: r.text ?? "",
    thread: strList(r.thread),
    quoted: quotedText
      ? {
          author: {
            name: str(pickKey(quoted, "author_name", "authorName")) ?? str(quotedAuthor.name) ?? "",
            handle: str(pickKey(quoted, "author_handle", "authorHandle")) ?? str(quotedAuthor.handle) ?? "",
            avatarUrl: avatarFor(
              r.platform,
              str(pickKey(quoted, "author_avatar_url", "authorAvatarUrl")) ?? str(pickKey(quotedAuthor, "avatar_url", "avatarUrl")),
              str(pickKey(quoted, "author_handle", "authorHandle")) ?? str(quotedAuthor.handle),
            ),
          },
          text: quotedText,
          url: str(quoted.url) ?? r.url,
        }
      : null,
    media: (Array.isArray(r.media) ? r.media : []).map(obj).flatMap((m): Media[] => {
      const url = str(m.url);
      const preview = str(pickKey(m, "preview_url", "previewUrl", "poster"));
      const alt = str(pickKey(m, "alt", "alt_text", "altText")) ?? "";
      if (/video|gif/i.test(str(pickKey(m, "kind", "type")) ?? "")) {
        const playable = url && !isImageUrl(url) ? url : null;
        const poster = preview ?? (url && isImageUrl(url) ? url : null);
        return playable || poster ? [{ kind: "video", url: playable, poster, alt }] : [];
      }
      return url ? [{ kind: "image", url, alt }] : [];
    }),
    metrics: {
      views: num(pickKey(metrics, "views", "impressions")) ?? 0,
      likes: num(pickKey(metrics, "likes", "reactions")) ?? 0,
      comments: num(pickKey(metrics, "comments", "replies")) ?? 0,
      reposts: num(pickKey(metrics, "reposts", "retweets", "shares")) ?? 0,
      saves: num(pickKey(metrics, "saves", "bookmarks")) ?? 0,
    },
    publishedAt: r.posted_at ?? r.bookmarked_at ?? r.first_seen_at,
    outlier: num(r.outlier_score),
    // LinkedIn doesn't always say when a post was saved; first sight is the next best thing.
    savedAt: r.bookmarked_at ?? r.first_seen_at,
    analysis: hook
      ? {
          hook,
          hookPattern: r.hook_pattern ?? str(pickKey(a, "hook_pattern", "hookPattern")) ?? "",
          format: str(a.format) ?? "",
          whyItWorks: strList(pickKey(a, "why_it_works", "whyItWorks")),
          skeleton: strList(a.skeleton),
          pillar: r.pillar ?? str(a.pillar),
          borrow: str(pickKey(a, "borrow", "what_to_borrow", "whatToBorrow")) ?? "",
          design: pickKey(a, "design", "design_flag", "designFlag", "is_design") === true,
          confidence: confidence === "high" || confidence === "low" ? confidence : "medium",
        }
      : null,
  };
}

async function readSwipes(): Promise<SwipeFile> {
  const db = supabase();
  const [swipes, runs] = await Promise.all([
    db.from("swipes").select("*").order("bookmarked_at", { ascending: false, nullsFirst: false }).limit(2000),
    db.from("swipe_runs").select("*").order("started_at", { ascending: false }).limit(20),
  ]);
  if (swipes.error) throw new Error(`Could not load swipes: ${swipes.error.message}`);
  if (runs.error) throw new Error(`Could not load sync history: ${runs.error.message}`);
  return {
    swipes: (swipes.data as SwipeRow[]).map(fromSwipeRow),
    runs: (runs.data as RunRow[]).map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      trigger: r.trigger,
      status: r.status,
      fetched: r.fetched ?? 0,
      inserted: r.inserted ?? 0,
      updated: r.updated ?? 0,
      failed: r.failed ?? 0,
      error: r.error,
    })),
  };
}

