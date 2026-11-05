/**
 * LinkedIn's creator analytics export (AggregateAnalytics_<name>_<from>_<to>.xlsx) → database rows.
 * Pure: takes the sheets as rows of text.
 */

import { emptyDay, emptyPost, middayIst, toInt as int, type DailyRow, type ParsedExport, type PostRow } from "./imports";

/** "7/24/2026" → "2026-07-24". */
export function usDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** The number that identifies a post in its URL: "…-share-7518691572713095168-F34R" or "urn:li:share:752…". */
export function linkedinPostId(url: string): string | null {
  return /(?:share|ugcPost|activity)[-:](\d{15,})/i.exec(url)?.[1] ?? null;
}

const find = (sheets: Map<string, string[][]>, name: string) =>
  [...sheets].find(([k]) => k.trim().toUpperCase() === name)?.[1] ?? [];

export function parseLinkedInExport(sheets: Map<string, string[][]>): ParsedExport {
  // DISCOVERY: period and headline numbers.
  const discovery = find(sheets, "DISCOVERY");
  const period = (discovery.find((r) => /overall performance/i.test(r[0] ?? ""))?.[1] ?? "").split("-").map((s) => usDate(s));
  const headline = (label: RegExp) => int(discovery.find((r) => label.test(r[0] ?? ""))?.[1]);

  // ENGAGEMENT and FOLLOWERS: one row per day.
  const byDate = new Map<string, DailyRow>();
  for (const r of find(sheets, "ENGAGEMENT")) {
    const date = usDate(r[0] ?? "");
    if (date) byDate.set(date, { ...emptyDay("linkedin", date), impressions: int(r[1]) ?? 0, engagements: int(r[2]) ?? 0 });
  }
  const followerRows = find(sheets, "FOLLOWERS");
  const totalRow = followerRows.find((r) => /total followers on/i.test(r[0] ?? ""));
  const total = int(totalRow?.[1]);
  const totalOn = usDate(/on\s+(\S+)/i.exec(totalRow?.[0] ?? "")?.[1] ?? "");
  for (const r of followerRows) {
    const date = usDate(r[0] ?? "");
    if (!date) continue;
    const day = byDate.get(date) ?? emptyDay("linkedin", date);
    day.new_followers = int(r[1]);
    byDate.set(date, day);
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Work followers back from the closing total: each day ends with the total minus later gains.
  if (total != null && totalOn) {
    let running = total;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].date > totalOn) continue;
      days[i].followers = running;
      running -= days[i].new_followers ?? 0;
    }
  }

  // Posts: TOP POSTS has two side-by-side lists (by engagements, by impressions); MOST RECENT POSTS has detail.
  const posts = new Map<string, PostRow>();
  const post = (url: string, date: string | null) => {
    const id = linkedinPostId(url);
    if (!id || !date) return null;
    const p = posts.get(id) ?? { ...emptyPost("linkedin", id, url, middayIst(date)), text: textFromSlug(url) };
    posts.set(id, p);
    return p;
  };
  const top = find(sheets, "TOP POSTS");
  const header = top.findIndex((r) => r[0] === "Post URL");
  for (const r of header >= 0 ? top.slice(header + 1) : []) {
    const a = r[0] ? post(r[0], usDate(r[1] ?? "")) : null;
    if (a) a.engagements = int(r[2]);
    const b = r[4] ? post(r[4], usDate(r[5] ?? "")) : null;
    if (b) b.impressions = int(r[6]);
  }
  const recent = find(sheets, "MOST RECENT POSTS");
  const cols = recent[0] ?? [];
  const col = (r: string[], name: string) => r[cols.findIndex((c) => c.trim().toLowerCase() === name)];
  for (const r of recent.slice(1)) {
    const p = r[0] ? post(r[0], usDate(r[1] ?? "")) : null;
    if (!p) continue;
    p.post_type = col(r, "post type") || p.post_type;
    p.impressions = int(col(r, "impressions")) ?? p.impressions;
    p.likes = int(col(r, "reactions"));
    p.comments = int(col(r, "comments"));
    p.reposts = int(col(r, "reposts"));
    p.saves = int(col(r, "saves"));
    p.shares = int(col(r, "sends"));
    p.new_followers = int(col(r, "followers gained"));
    p.profile_visits = int(col(r, "profile viewers"));
    if (p.engagements == null && p.likes != null) {
      p.engagements = (p.likes ?? 0) + (p.comments ?? 0) + (p.reposts ?? 0) + (p.saves ?? 0) + (p.shares ?? 0);
    }
  }

  const demographics = (name: string) =>
    find(sheets, name)
      .slice(1)
      .filter((r) => r[0] && r[1])
      .map((r) => ({ kind: r[0], value: r[1], share: r[2] ?? "" }));

  const from = period[0] ?? days[0]?.date;
  const to = period[1] ?? days[days.length - 1]?.date;
  if (!from || !to) throw new Error("This doesn't look like a LinkedIn analytics export (no period or daily data).");
  return {
    summary: {
      platform: "linkedin",
      kind: "aggregate",
      period_from: from,
      period_to: to,
      impressions: headline(/^impressions$/i),
      members_reached: headline(/members reached/i),
      followers: total,
      audience: demographics("AUDIENCE DEMOGRAPHICS"),
      content_audience: demographics("CONTENT DEMOGRAPHICS"),
    },
    days,
    posts: [...posts.values()],
  };
}

/** The export has no post text; the URL slug is the opening words ("ai-will-replace-designers…"). */
export function textFromSlug(url: string): string | null {
  const slug = /\/posts\/[^_/]+_(.+?)-(?:share|ugcpost|activity)-\d/i.exec(url)?.[1];
  if (!slug) return null;
  const words = decodeURIComponent(slug).replace(/-/g, " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}…` : null;
}
