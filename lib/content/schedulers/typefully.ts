import { TYPEFULLY_SOCIAL_SET_ID } from "../config";
import { NotConnected, cached } from "../errors";
import type { Platform, PostStatus, ScheduledPost } from "../types";

/**
 * Typefully (API v2), read-only: Daksh's drafts across every status, for the content calendar.
 * One Typefully draft can post to X and LinkedIn; it becomes one calendar post per platform.
 * Needs TYPEFULLY_API_KEY (Typefully → Settings → API).
 */

const API = "https://api.typefully.com/v2";
const WINDOW_DAYS = 21;
const PAGE = 50;
const MAX_PAGES = 10;

export interface TypefullyDraft {
  id: number;
  status: string;
  /** A string in list responses (may be an object or null). */
  preview: unknown;
  draft_title?: string | null;
  scheduled_date: string | null;
  published_at: string | null;
  private_url: string | null;
  x_post_enabled?: boolean;
  linkedin_post_enabled?: boolean;
  x_post_published_at?: string | null;
  linkedin_post_published_at?: string | null;
  x_published_url?: string | null;
  linkedin_published_url?: string | null;
}

const STATUS: Record<string, PostStatus> = {
  draft: "draft",
  scheduled: "scheduled",
  publishing: "scheduled",
  planned: "planned",
  published: "published",
  error: "failed",
};

function previewText(d: TypefullyDraft): string {
  const p = d.preview;
  const text =
    typeof p === "string"
      ? p
      : p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string"
        ? (p as { text: string }).text
        : "";
  return text.trim() || d.draft_title?.trim() || "(empty draft)";
}

/** One draft → one calendar post per platform it's set to post to. */
export function fromTypefullyDraft(d: TypefullyDraft): ScheduledPost[] {
  const status = STATUS[d.status];
  if (!status) return [];
  const platforms: Platform[] = [];
  if (d.x_post_enabled) platforms.push("x");
  if (d.linkedin_post_enabled) platforms.push("linkedin");
  return platforms.map((platform) => {
    const publishedAt = platform === "x" ? d.x_post_published_at : d.linkedin_post_published_at;
    const publishedUrl = platform === "x" ? d.x_published_url : d.linkedin_published_url;
    // A draft can publish on one platform and not the other.
    const own: PostStatus = status === "published" && !publishedAt && !publishedUrl ? "failed" : status;
    return {
      id: `typefully-${d.id}-${platform}`,
      scheduler: "typefully" as const,
      platform,
      status: own,
      at: own === "draft" ? null : (publishedAt ?? d.published_at ?? d.scheduled_date),
      text: previewText(d),
      url: publishedUrl ?? d.private_url,
      error: own === "failed" ? "Typefully couldn't publish this post." : null,
    };
  });
}

async function get(key: string, path: string): Promise<{ results: TypefullyDraft[]; next: string | null }> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (res.status === 429) throw new Error("Typefully is rate limiting us; try again in a minute.");
  if (res.status === 401 || res.status === 403) throw new Error("Typefully rejected the API key (TYPEFULLY_API_KEY).");
  if (!res.ok) throw new Error(`Typefully returned ${res.status}.`);
  return res.json();
}

/** All drafts with one status, newest first by `orderBy`, stopping once `stop` says the rest are too old. */
async function listAll(key: string, status: string, orderBy: string, stop?: (d: TypefullyDraft) => boolean) {
  const out: TypefullyDraft[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { results, next } = await get(
      key,
      `/social-sets/${TYPEFULLY_SOCIAL_SET_ID}/drafts?status=${status}&order_by=${orderBy}&limit=${PAGE}&offset=${page * PAGE}`,
    );
    out.push(...results);
    if (!next || !results.length || (stop && stop(results[results.length - 1]))) break;
  }
  return out;
}

const read = cached(3 * 60_000, async () => {
  const key = process.env.TYPEFULLY_API_KEY;
  if (!key) throw new NotConnected(["TYPEFULLY_API_KEY"]);
  const now = Date.now();
  const from = now - WINDOW_DAYS * 86_400_000;
  const tooOld = (d: TypefullyDraft) => Date.parse(d.published_at ?? d.scheduled_date ?? "") < from;
  const lists = await Promise.all([
    listAll(key, "published", "-published_at", tooOld),
    listAll(key, "scheduled", "scheduled_date"),
    listAll(key, "planned", "scheduled_date"),
    listAll(key, "publishing", "scheduled_date"),
    listAll(key, "error", "-scheduled_date", tooOld),
    listAll(key, "draft", "-updated_at"),
  ]);
  return lists.flat().flatMap(fromTypefullyDraft);
});

/** Daksh's Typefully posts from 3 weeks back to 3 weeks ahead, plus every unslotted draft. */
export async function readTypefully(now: Date): Promise<ScheduledPost[]> {
  return inWindow(await read(), now);
}

export function inWindow(posts: ScheduledPost[], now: Date): ScheduledPost[] {
  const from = now.getTime() - WINDOW_DAYS * 86_400_000;
  const to = now.getTime() + WINDOW_DAYS * 86_400_000;
  return posts.filter((p) => p.at == null || (Date.parse(p.at) >= from && Date.parse(p.at) <= to));
}

