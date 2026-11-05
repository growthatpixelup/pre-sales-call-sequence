/** Rows for the analytics-export tables (migration 014), shared by the X and LinkedIn parsers. */

import type { Platform } from "./types";

export interface DailyRow {
  platform: Platform;
  date: string;
  impressions: number;
  engagements: number;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  new_followers: number | null;
  followers: number | null;
  profile_visits: number | null;
}

export interface PostRow {
  platform: Platform;
  post_id: string;
  url: string;
  published_at: string;
  text: string | null;
  post_type: string | null;
  impressions: number | null;
  engagements: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  shares: number | null;
  new_followers: number | null;
  profile_visits: number | null;
}

export interface ExportRow {
  platform: Platform;
  kind: string;
  period_from: string;
  period_to: string;
  impressions: number | null;
  members_reached: number | null;
  followers: number | null;
  audience: { kind: string; value: string; share: string }[];
  content_audience: { kind: string; value: string; share: string }[];
}

export interface ParsedExport {
  summary: ExportRow;
  days: DailyRow[];
  posts: PostRow[];
}

export const toInt = (s: string | undefined | null) => {
  const t = (s ?? "").replace(/[,\s]/g, "");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? Math.round(n) : null;
};

/** A calendar day as midday India time, for posts whose export gives only the date. */
export const middayIst = (ymd: string) => `${ymd}T06:30:00.000Z`;

export const emptyDay = (platform: Platform, date: string): DailyRow => ({
  platform, date, impressions: 0, engagements: 0, likes: null, comments: null, reposts: null, saves: null,
  new_followers: null, followers: null, profile_visits: null,
});

export const emptyPost = (platform: Platform, post_id: string, url: string, published_at: string): PostRow => ({
  platform, post_id, url, published_at, text: null, post_type: null, impressions: null, engagements: null, likes: null,
  comments: null, reposts: null, saves: null, shares: null, new_followers: null, profile_visits: null,
});
