/**
 * X's analytics export (x.com → Analytics → Export data): the account overview CSV (one row per day)
 * and the content CSV (one row per post). Pure; headers are matched loosely, as X renames them.
 */

import { emptyDay, emptyPost, middayIst, toInt, type DailyRow, type ParsedExport, type PostRow } from "./imports";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Thu, Oct 30, 2025", "2025-10-30", "10/30/2025" or an ISO timestamp → "2025-10-30". */
export function xDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

/** Column lookup by any of several header names. */
function columns(header: string[]) {
  const idx = new Map(header.map((h, i) => [norm(h), i]));
  return (row: string[], ...names: string[]) => {
    for (const n of names) {
      const i = idx.get(norm(n));
      if (i != null) return row[i];
    }
    return undefined;
  };
}

export type XCsvKind = "overview" | "content";

export function xCsvKind(rows: string[][]): XCsvKind | null {
  const h = (rows[0] ?? []).map(norm);
  if (h.includes("postid") || h.includes("postlink") || h.includes("tweetid") || h.includes("posttext")) return "content";
  if (h.includes("date") && h.includes("impressions")) return "overview";
  return null;
}

export function parseXOverview(rows: string[][]): ParsedExport {
  const col = columns(rows[0] ?? []);
  const days: DailyRow[] = [];
  for (const r of rows.slice(1)) {
    const date = xDate(col(r, "Date") ?? "");
    if (!date) continue;
    days.push({
      ...emptyDay("x", date),
      impressions: toInt(col(r, "Impressions")) ?? 0,
      engagements: toInt(col(r, "Engagements")) ?? 0,
      likes: toInt(col(r, "Likes")),
      comments: toInt(col(r, "Replies")),
      reposts: toInt(col(r, "Reposts", "Retweets")),
      saves: toInt(col(r, "Bookmarks")),
      new_followers: toInt(col(r, "New follows", "New followers", "Follows")),
      profile_visits: toInt(col(r, "Profile visits")),
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length) throw new Error("No daily rows in this X overview export.");
  return { summary: summary("overview", days.map((d) => d.date), days.reduce((n, d) => n + d.impressions, 0)), days, posts: [] };
}

export function parseXContent(rows: string[][], handle: string): ParsedExport {
  const col = columns(rows[0] ?? []);
  const posts: PostRow[] = [];
  for (const r of rows.slice(1)) {
    const link = col(r, "Post Link", "Tweet permalink", "Permalink") ?? "";
    const id = col(r, "Post id", "Tweet id") || /status\/(\d+)/.exec(link)?.[1];
    const date = xDate(col(r, "Date", "Time") ?? "");
    if (!id || !date) continue;
    const raw = col(r, "Date", "Time") ?? "";
    const at = /\d{2}:\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : middayIst(date);
    posts.push({
      ...emptyPost("x", id, link || `https://x.com/${handle}/status/${id}`, at),
      text: col(r, "Post text", "Tweet text", "Text") ?? null,
      impressions: toInt(col(r, "Impressions")),
      engagements: toInt(col(r, "Engagements")),
      likes: toInt(col(r, "Likes")),
      comments: toInt(col(r, "Replies")),
      reposts: toInt(col(r, "Reposts", "Retweets")),
      saves: toInt(col(r, "Bookmarks")),
      shares: toInt(col(r, "Shares")),
      new_followers: toInt(col(r, "New follows")),
      profile_visits: toInt(col(r, "Profile visits")),
    });
  }
  if (!posts.length) throw new Error("No posts in this X content export.");
  const dates = posts.map((p) => p.published_at.slice(0, 10));
  return { summary: summary("content", dates, posts.reduce((n, p) => n + (p.impressions ?? 0), 0)), days: [], posts };
}

function summary(kind: string, dates: string[], impressions: number) {
  const sorted = [...dates].sort();
  return {
    platform: "x" as const,
    kind,
    period_from: sorted[0],
    period_to: sorted[sorted.length - 1],
    impressions,
    members_reached: null,
    followers: null,
    audience: [],
    content_audience: [],
  };
}
