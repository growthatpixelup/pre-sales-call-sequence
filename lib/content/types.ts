/**
 * Content OS: analytics, calendar and swipe file for the creator's X and LinkedIn.
 * Every data source sits behind lib/content/sources.ts and returns a SourceResult, so one source
 * failing or not being connected never takes the rest of a page down.
 */

export const PLATFORMS = ["x", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = { x: "X", linkedin: "LinkedIn" };

export type SourceResult<T> =
  | { status: "ok"; data: T }
  | { status: "not_connected"; source: string; /** Env vars to set; empty when there's no integration yet. */ missing: string[] }
  | { status: "error"; source: string; message: string };

export interface Author {
  name: string;
  handle: string;
  avatarUrl: string | null;
}

export interface PostMetrics {
  views: number;
  /** Null where the source only reports a total (LinkedIn's top-posts list). */
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  /** Bookmarks / saves; null where the source doesn't report them (Buffer). */
  saves: number | null;
  /** The source's own engagement total, when it gives one. */
  engagements?: number | null;
}

export interface Media {
  kind: "image" | "video";
  /** The image, or the playable video file. Null for a video we only have a thumbnail of. */
  url: string | null;
  /** Thumbnail for a video (X gives the bot thumbnails, not video files). */
  poster?: string | null;
  alt: string;
}

export interface QuotedPost {
  author: Author;
  text: string;
  url: string;
}

export interface Post {
  id: string;
  platform: Platform;
  url: string;
  author: Author;
  text: string;
  /** Follow-up posts in a thread, after the first. */
  thread: string[];
  quoted: QuotedPost | null;
  media: Media[];
  metrics: PostMetrics;
  publishedAt: string;
  /** Views against the account's median post; null when there's nothing to compare with. */
  outlier: number | null;
}

/** One platform's numbers for one day ("YYYY-MM-DD" in the dashboard time zone). */
export interface DailyMetrics {
  date: string;
  impressions: number;
  engagements: number;
  posts: number;
  /** Null where the source doesn't report it for that day. */
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  newFollowers: number | null;
  /** Followers at the end of the day. */
  followers: number | null;
}

export interface PlatformAnalytics {
  daily: DailyMetrics[];
  posts: Post[];
  /** Where the numbers came from, one line per source, for the page to say. */
  sources: string[];
  /** First day with impression data; null if none. */
  since: string | null;
}

// ---------- Calendar ----------

export const SCHEDULERS = ["typefully", "buffer"] as const;
export type Scheduler = (typeof SCHEDULERS)[number];
export const SCHEDULER_LABELS: Record<Scheduler, string> = { typefully: "Typefully", buffer: "Buffer" };

export const POST_STATUSES = ["published", "scheduled", "planned", "draft", "failed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  published: "Published",
  scheduled: "Scheduled",
  /** Typefully: has a date but won't publish until someone confirms it. */
  planned: "Planned",
  draft: "Draft",
  failed: "Failed",
};

/** One post as a scheduler reports it. */
export interface ScheduledPost {
  id: string;
  scheduler: Scheduler;
  platform: Platform;
  status: PostStatus;
  /** Publish time (published, scheduled, failed). Null for drafts without a slot. */
  at: string | null;
  text: string;
  /** Link to the live post, or to the post in the scheduler. */
  url: string | null;
  error: string | null;
}

/** A post after merging both schedulers: the same post seen in both counts once. */
export interface CalendarPost extends Omit<ScheduledPost, "scheduler"> {
  schedulers: Scheduler[];
}

// ---------- Swipe file ----------

export const MEDIA_FILTERS = ["any", "images", "video", "text", "design"] as const;
export type MediaFilter = (typeof MEDIA_FILTERS)[number];
export const MEDIA_FILTER_LABELS: Record<MediaFilter, string> = {
  any: "Any",
  images: "Images",
  video: "Video",
  text: "Text only",
  design: "Design",
};

export interface SwipeAnalysis {
  hook: string;
  hookPattern: string;
  format: string;
  whyItWorks: string[];
  skeleton: string[];
  pillar: string | null;
  borrow: string;
  /** The post's design (visual, layout) is what makes it work. */
  design: boolean;
  confidence: "high" | "medium" | "low";
}

export interface Swipe extends Post {
  savedAt: string;
  /** Null until the bot has written its breakdown. */
  analysis: SwipeAnalysis | null;
}

export interface SwipeRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: "schedule" | "manual";
  /** partial: some posts synced, some failed. */
  status: "running" | "ok" | "partial" | "failed";
  fetched: number;
  inserted: number;
  updated: number;
  failed: number;
  error: string | null;
}

export interface SwipeFile {
  swipes: Swipe[];
  runs: SwipeRun[];
}

export function engagementRate(m: PostMetrics): number | null {
  if (!m.views) return null;
  const parts = [m.likes, m.comments, m.reposts, m.saves];
  if (parts.every((x) => x == null)) return m.engagements != null ? m.engagements / m.views : null;
  return parts.reduce<number>((n, x) => n + (x ?? 0), 0) / m.views;
}
