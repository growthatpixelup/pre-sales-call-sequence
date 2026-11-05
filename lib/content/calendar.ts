/**
 * Calendar math for Content OS: merging the two schedulers, target slots from the cadence,
 * pipeline health, and the 4-week grid. Pure: callers pass the time and time zone.
 */

import { localDate } from "@/lib/emails/time";
import { CADENCE, type Cadence } from "./config";
import { daysBetween, shiftDays, weekdayIndex } from "./periods";
import { PLATFORMS, PLATFORM_LABELS, type CalendarPost, type Platform, type PostStatus, type ScheduledPost } from "./types";

/** Same post if the text matches after this and the times are this close. */
const SAME_POST_WINDOW_MS = 30 * 60_000;

export function normaliseText(text: string) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(\.\.\.|…)\s*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Same wording, allowing for one side being a trimmed preview (Typefully lists show ~100
 * characters): the shorter text must start the longer one, and be long enough to mean something.
 */
export function sameText(a: string, b: string) {
  const [x, y] = [normaliseText(a), normaliseText(b)].sort((p, q) => p.length - q.length);
  if (!x) return false;
  return x === y || (x.length >= 24 && y.startsWith(x));
}

/** When the same post shows up twice, the furthest-along status wins. */
const STATUS_RANK: Record<PostStatus, number> = { draft: 0, planned: 1, scheduled: 2, failed: 3, published: 4 };

/**
 * One list from both schedulers. A post that appears in both (same platform, same text, within
 * 30 minutes, or both unslotted drafts) is kept once, listing both schedulers.
 */
export function mergeSchedulers(items: ScheduledPost[]): CalendarPost[] {
  const merged: CalendarPost[] = [];
  for (const item of items) {
    const same = merged.find(
      (m) =>
        m.platform === item.platform &&
        sameText(m.text, item.text) &&
        (m.at == null && item.at == null
          ? true
          : m.at != null && item.at != null && Math.abs(Date.parse(m.at) - Date.parse(item.at)) <= SAME_POST_WINDOW_MS),
    );
    if (!same) {
      const { scheduler, ...rest } = item;
      merged.push({ ...rest, schedulers: [scheduler] });
      continue;
    }
    if (!same.schedulers.includes(item.scheduler)) same.schedulers.push(item.scheduler);
    if (STATUS_RANK[item.status] > STATUS_RANK[same.status]) {
      Object.assign(same, { status: item.status, at: item.at, url: item.url ?? same.url, error: item.error });
    }
    if (!same.url && item.url) same.url = item.url;
    // Keep the fuller text (Typefully lists only a preview).
    if (item.text.length > same.text.length) same.text = item.text;
  }
  return merged;
}

/** Cadence days are counted from a fixed Monday so "every other day" doesn't shift day to day. */
const CADENCE_EPOCH = "2024-01-01";

export function targetSlots(ymd: string, cadence: Cadence): string[] {
  if (cadence.byWeekday) return cadence.byWeekday[weekdayIndex(ymd)] ?? [];
  const n = Math.max(1, cadence.everyNDays);
  return daysBetween(CADENCE_EPOCH, ymd) % n === 0 ? cadence.slots : [];
}

export type Health = "healthy" | "attention" | "dry";
export const HEALTH_LABELS: Record<Health, string> = {
  healthy: "Healthy",
  attention: "Needs attention",
  dry: "Queue running dry",
};

export interface DayCell {
  date: string;
  isToday: boolean;
  isPast: boolean;
  posts: CalendarPost[];
  openSlots: { platform: Platform; time: string }[];
}

export interface CalendarView {
  today: string;
  weeks: DayCell[][];
  health: Health;
  issues: string[];
  /** Target slots in the next 7 days (today included) and how many have a post. */
  next7: { filled: number; target: number };
  /** Posts published in the last 14 days (before today) against the target. */
  last14: { posted: number; target: number; byPlatform: Record<Platform, { posted: number; target: number }> };
  /** Whole days ahead, from today, with every target slot filled. */
  runwayDays: number;
  /** Posts queued (scheduled) from now on. */
  queued: number;
  drafts: CalendarPost[];
  failed: CalendarPost[];
  /** Dated in Typefully but not confirmed, so they won't publish on their own (from now on). */
  planned: CalendarPost[];
}

const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fmtDay = (ymd: string) => dayLabel.format(new Date(`${ymd}T12:00:00Z`));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildCalendar(
  posts: CalendarPost[],
  now: Date,
  tz: string,
  cadence: Record<Platform, Cadence> = CADENCE,
): CalendarView {
  const today = localDate(now, tz);
  const dayOf = (p: CalendarPost) => (p.at ? localDate(new Date(p.at), tz) : null);
  const slotted = posts.filter((p) => p.at).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const on = (ymd: string, platform: Platform, statuses: PostStatus[]) =>
    slotted.filter((p) => p.platform === platform && statuses.includes(p.status) && dayOf(p) === ymd);
  const FILLS: PostStatus[] = ["published", "scheduled"];

  // Next 7 days: is every target slot taken by a scheduled or published post?
  const openByPlatform: Record<Platform, string[]> = { x: [], linkedin: [] };
  let next7Target = 0;
  let next7Filled = 0;
  for (let i = 0; i < 7; i++) {
    const day = shiftDays(today, i);
    for (const platform of PLATFORMS) {
      const target = targetSlots(day, cadence[platform]).length;
      const filled = Math.min(target, on(day, platform, FILLS).length);
      next7Target += target;
      next7Filled += filled;
      for (let k = filled; k < target; k++) openByPlatform[platform].push(day);
    }
  }

  // Runway: consecutive days from today with every slot filled.
  let runwayDays = 0;
  for (let i = 0; i < 60; i++) {
    const day = shiftDays(today, i);
    const full = PLATFORMS.every(
      (platform) => on(day, platform, FILLS).length >= targetSlots(day, cadence[platform]).length,
    );
    if (!full) break;
    runwayDays++;
  }

  // Last 14 days: posts published vs target, and target days with nothing out.
  const byPlatform = { x: { posted: 0, target: 0 }, linkedin: { posted: 0, target: 0 } };
  const missed: Record<Platform, string[]> = { x: [], linkedin: [] };
  for (let i = 1; i <= 14; i++) {
    const day = shiftDays(today, -i);
    for (const platform of PLATFORMS) {
      const target = targetSlots(day, cadence[platform]).length;
      const posted = on(day, platform, ["published"]).length;
      byPlatform[platform].target += target;
      byPlatform[platform].posted += posted;
      if (target > 0 && posted === 0) missed[platform].push(day);
    }
  }
  const last14 = {
    posted: byPlatform.x.posted + byPlatform.linkedin.posted,
    target: byPlatform.x.target + byPlatform.linkedin.target,
    byPlatform,
  };

  const recentFrom = shiftDays(today, -14);
  const failed = slotted.filter((p) => p.status === "failed" && (dayOf(p) ?? "") >= recentFrom).reverse();
  const drafts = posts.filter((p) => p.status === "draft");
  const queued = slotted.filter((p) => p.status === "scheduled" && Date.parse(p.at!) >= now.getTime()).length;
  const planned = slotted.filter((p) => p.status === "planned" && Date.parse(p.at!) >= now.getTime());

  const issues: string[] = [];
  for (const platform of PLATFORMS) {
    const open = openByPlatform[platform];
    if (open.length) {
      const days = [...new Set(open)].map((d) => fmtDay(d).split(" ")[0]);
      issues.push(`${plural(open.length, `open ${PLATFORM_LABELS[platform]} slot`)} in the next 7 days (${days.join(", ")}).`);
    }
  }
  for (const platform of PLATFORMS) {
    const days = missed[platform];
    if (days.length) {
      issues.push(
        // Most recent four, oldest first; "…" stands for the earlier ones.
        `No ${PLATFORM_LABELS[platform]} post on ${plural(days.length, "target day")} in the last 2 weeks (${days.length > 4 ? "…, " : ""}${days
          .slice(0, 4)
          .reverse()
          .map(fmtDay)
          .join(", ")}).`,
      );
    }
  }
  if (planned.length) {
    issues.push(
      `${plural(planned.length, "planned post")} in Typefully ${planned.length === 1 ? "isn't" : "aren't"} confirmed, so ${planned.length === 1 ? "it won't" : "they won't"} publish on ${planned.length === 1 ? "its" : "their"} own.`,
    );
  }
  if (failed.length) issues.push(`${plural(failed.length, "post")} failed to publish in the last 2 weeks.`);
  if (runwayDays <= 1) issues.push(runwayDays === 0 ? "Today's slots aren't all filled." : "The queue only covers today.");

  const fill = next7Target ? next7Filled / next7Target : 1;
  const pace = last14.target ? last14.posted / last14.target : 1;
  const health: Health =
    runwayDays <= 1 || fill < 0.4
      ? "dry"
      : fill < 0.85 || pace < 0.85 || failed.length > 0 || planned.length > 0 || Object.values(missed).some((m) => m.length)
        ? "attention"
        : "healthy";

  // Grid: last week, this week and the next two, Monday first.
  const start = shiftDays(today, -weekdayIndex(today) - 7);
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 4; w++) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDays(start, w * 7 + d);
      const dayPosts = slotted.filter((p) => dayOf(p) === date);
      const openSlots: DayCell["openSlots"] = [];
      if (date >= today) {
        for (const platform of PLATFORMS) {
          const filling = dayPosts.filter((p) => p.platform === platform && FILLS.includes(p.status));
          for (const time of openSlotTimes(targetSlots(date, cadence[platform]), filling.map((p) => minutesOfDay(p.at!, tz)))) {
            openSlots.push({ platform, time });
          }
        }
      }
      week.push({ date, isToday: date === today, isPast: date < today, posts: dayPosts, openSlots });
    }
    weeks.push(week);
  }

  return {
    today,
    weeks,
    health,
    issues,
    next7: { filled: next7Filled, target: next7Target },
    last14,
    runwayDays,
    queued,
    drafts,
    failed,
    planned,
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Minutes past local midnight. */
export function minutesOfDay(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/**
 * Which slot times are still open, given the times (minutes past midnight) of the day's posts.
 * Each post takes the nearest free slot, so a post at 21:00 fills the 21:00 slot and the open one
 * shows as 17:00. A post far from every slot still takes one: the day's count is what matters.
 */
export function openSlotTimes(slots: string[], postMinutes: number[]): string[] {
  const free = [...slots];
  for (const at of [...postMinutes].sort((a, b) => a - b)) {
    if (!free.length) break;
    let best = 0;
    for (let i = 1; i < free.length; i++) {
      if (Math.abs(toMinutes(free[i]) - at) < Math.abs(toMinutes(free[best]) - at)) best = i;
    }
    free.splice(best, 1);
  }
  return free;
}
