import { addDays, atLocalTime, localDate, safeTimeZone } from "@/lib/emails/time";
import { LEAD_STAGES, OPEN_STAGES, type Lead, type LeadStage } from "@/lib/leads/types";

/**
 * Pipeline analytics for the overview page. Days are calendar days in DASHBOARD_TIMEZONE. A call
 * counts as booked on the day it was booked in Cal.com (not the day of the call).
 */

// ---------------------------------------------------------------------------------------------
// Budget values

/**
 * Reads an investment range answer as numbers: "$10k - $15k" → 10,000–15,000, "$5,000 - $10,000",
 * "$50k+" → 50,000 and up. Returns null if there's no number in it.
 */
export function parseBudget(text: string | null): { min: number; max: number | null } | null {
  if (!text) return null;
  const numbers = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m|mn|million|thousand)?\b/gi)].map((m) => ({
    value: Number(m[1].replace(/,/g, "")),
    unit: m[2]?.toLowerCase() ?? null,
  }));
  if (!numbers.length) return null;
  // "10-15k": a number without a unit takes the unit of the one after it.
  const lastUnit = numbers[numbers.length - 1].unit;
  const scale = (unit: string | null) =>
    unit === "k" || unit === "thousand" ? 1_000 : unit === "m" || unit === "mn" || unit === "million" ? 1_000_000 : 1;
  const values = numbers.map((n) => n.value * scale(n.unit ?? lastUnit)).filter((v) => Number.isFinite(v));
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = values.length > 1 ? Math.max(...values) : /\+|above|over|more than/i.test(text) ? null : min;
  return { min, max };
}

/** The midpoint of the lead's investment range (or the old form's budget answer). */
export function estimatedValue(lead: Lead): number | null {
  const range = parseBudget(lead.investmentRange ?? lead.legacy.budget);
  if (!range) return null;
  return range.max == null ? range.min : (range.min + range.max) / 2;
}

/** The agreed deal value if set, otherwise the estimate from their investment range. */
export function leadValue(lead: Lead): number | null {
  return lead.dealValue ?? estimatedValue(lead);
}

const sumValues = (leads: Lead[]) => leads.reduce((total, lead) => total + (leadValue(lead) ?? 0), 0);

// ---------------------------------------------------------------------------------------------
// Date ranges

export const RANGE_PRESETS = [
  { value: "7d", label: "Last 7 days" },
  { value: "28d", label: "Last 28 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export const COMPARE_MODES = [
  { value: "previous", label: "Previous period" },
  { value: "year", label: "Same period last year" },
  { value: "none", label: "No comparison" },
] as const;
export type CompareMode = (typeof COMPARE_MODES)[number]["value"];

/** A span of whole days, `from` to `to` inclusive ("YYYY-MM-DD"). */
export interface DayRange {
  from: string;
  to: string;
}

export interface ResolvedRange {
  preset: RangePreset;
  compare: CompareMode;
  current: DayRange;
  previous: DayRange | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function dayCount({ from, to }: DayRange) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function shiftYear(ymd: string, years: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  // 29 Feb in a non-leap year becomes 28 Feb.
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function dashboardTimeZone() {
  return safeTimeZone(process.env.DASHBOARD_TIMEZONE);
}

/** Turns the page's search params into the current and comparison ranges. */
export function resolveRange(
  params: { range?: string; from?: string; to?: string; compare?: string },
  now: Date,
  /** When the first lead was booked (ISO), for "All time". */
  earliest: string | null,
): ResolvedRange {
  const tz = dashboardTimeZone();
  const today = localDate(now, tz);
  let preset = (RANGE_PRESETS.some((p) => p.value === params.range) ? params.range : "28d") as RangePreset;
  let compare = (COMPARE_MODES.some((c) => c.value === params.compare) ? params.compare : "previous") as CompareMode;

  let current: DayRange;
  switch (preset) {
    case "7d":
      current = { from: addDays(today, -6), to: today };
      break;
    case "90d":
      current = { from: addDays(today, -89), to: today };
      break;
    case "month":
      current = { from: `${today.slice(0, 8)}01`, to: today };
      break;
    case "last-month": {
      const lastDay = addDays(`${today.slice(0, 8)}01`, -1);
      current = { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
      break;
    }
    case "year":
      current = { from: `${today.slice(0, 4)}-01-01`, to: today };
      break;
    case "all":
      current = { from: earliest ? localDate(new Date(earliest), tz) : today, to: today };
      if (current.from > today) current.from = today;
      compare = "none";
      break;
    case "custom":
      if (params.from && params.to && YMD.test(params.from) && YMD.test(params.to)) {
        current = params.from <= params.to ? { from: params.from, to: params.to } : { from: params.to, to: params.from };
        break;
      }
      preset = "28d";
      current = { from: addDays(today, -27), to: today };
      break;
    default:
      current = { from: addDays(today, -27), to: today };
  }

  const previous: DayRange | null =
    compare === "previous"
      ? { from: addDays(current.from, -dayCount(current)), to: addDays(current.from, -1) }
      : compare === "year"
        ? { from: shiftYear(current.from, -1), to: shiftYear(current.to, -1) }
        : null;

  return { preset, compare, current, previous };
}

/** Start (inclusive) and end (exclusive) instants of a day range. */
function bounds(range: DayRange, tz: string) {
  return { start: atLocalTime(range.from, 0, tz).getTime(), end: atLocalTime(addDays(range.to, 1), 0, tz).getTime() };
}

function within(iso: string | null, b: { start: number; end: number }) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= b.start && t < b.end;
}

const formatDay = (ymd: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(new Date(`${ymd}T12:00:00Z`));

export function formatRange({ from, to }: DayRange) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = formatDay(from, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const end = formatDay(to, { day: "numeric", month: "short", year: "numeric" });
  return from === to ? end : `${start} – ${end}`;
}

// ---------------------------------------------------------------------------------------------
// Stats

const isLive = (lead: Lead) => lead.bookingStatus !== "cancelled" && lead.bookingStatus !== "rejected";

export interface PeriodStats {
  /** Calls booked in the period, including ones later cancelled. */
  booked: number;
  cancelled: number;
  /** Calls held (accepted, ended) in the period. */
  completed: number;
  /** Value of calls booked in the period that weren't cancelled. */
  budget: number;
  /** Of those, how many have no deal value or investment range to go on. */
  unpriced: number;
  /** Leads marked won in the period, and their value. */
  won: number;
  wonValue: number;
}

function periodStats(leads: Lead[], range: DayRange, tz: string, now: number): PeriodStats {
  const b = bounds(range, tz);
  const booked = leads.filter((l) => within(l.bookedAt, b));
  const live = booked.filter(isLive);
  const won = leads.filter((l) => l.stage === "won" && within(l.stageChangedAt ?? l.updatedAt, b));
  return {
    booked: booked.length,
    cancelled: booked.length - live.length,
    completed: leads.filter(
      (l) => l.bookingStatus === "accepted" && within(l.endTime, b) && Date.parse(l.endTime) <= now,
    ).length,
    budget: sumValues(live),
    unpriced: live.filter((l) => leadValue(l) == null).length,
    won: won.length,
    wonValue: sumValues(won),
  };
}

export interface Bucket {
  /** First day of the bucket. */
  from: string;
  to: string;
  label: string;
  booked: number;
  /** Bookings in the matching bucket of the comparison period. */
  previous: number | null;
  previousLabel: string | null;
}

/** Splits a range into days (up to 31 days), weeks (up to 26 weeks) or calendar months. */
function splitRange(range: DayRange): { unit: "day" | "week" | "month"; parts: DayRange[] } {
  const days = dayCount(range);
  const parts: DayRange[] = [];
  if (days <= 31) {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) parts.push({ from: d, to: d });
    return { unit: "day", parts };
  }
  if (days <= 182) {
    for (let d = range.from; d <= range.to; d = addDays(d, 7)) {
      const end = addDays(d, 6);
      parts.push({ from: d, to: end < range.to ? end : range.to });
    }
    return { unit: "week", parts };
  }
  let d = range.from;
  while (d <= range.to) {
    const [y, m] = d.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    parts.push({ from: d, to: monthEnd < range.to ? monthEnd : range.to });
    d = addDays(monthEnd, 1);
  }
  return { unit: "month", parts };
}

function bucketLabel(part: DayRange, unit: "day" | "week" | "month") {
  if (unit === "month") return formatDay(part.from, { month: "short", year: "numeric" });
  if (unit === "week") return formatRange(part);
  return formatDay(part.from, { day: "numeric", month: "short" });
}

function bookingSeries(leads: Lead[], range: ResolvedRange, tz: string) {
  const current = splitRange(range.current);
  // The comparison period is split the same way, then matched bucket by bucket.
  const previous = range.previous ? splitRange(range.previous).parts : null;
  const count = (part: DayRange) => {
    const b = bounds(part, tz);
    return leads.filter((l) => within(l.bookedAt, b)).length;
  };
  const buckets: Bucket[] = current.parts.map((part, i) => {
    const prev = previous?.[i] ?? null;
    return {
      ...part,
      label: bucketLabel(part, current.unit),
      booked: count(part),
      previous: prev ? count(prev) : null,
      previousLabel: prev ? bucketLabel(prev, current.unit) : null,
    };
  });
  return { unit: current.unit, buckets };
}

export interface StageRow {
  stage: LeadStage;
  count: number;
  value: number;
}

export function buildAnalytics(leads: Lead[], range: ResolvedRange, nowMs: number) {
  const tz = dashboardTimeZone();
  const b = bounds(range.current, tz);
  const bookedInRange = leads.filter((l) => within(l.bookedAt, b));
  const liveInRange = bookedInRange.filter(isLive);

  const stages: StageRow[] = LEAD_STAGES.map((stage) => {
    const inStage = liveInRange.filter((l) => l.stage === stage);
    return { stage, count: inStage.length, value: sumValues(inStage) };
  });
  const won = liveInRange.filter((l) => l.stage === "won").length;
  const lost = liveInRange.filter((l) => l.stage === "lost").length;

  return {
    current: periodStats(leads, range.current, tz, nowMs),
    previous: range.previous ? periodStats(leads, range.previous, tz, nowMs) : null,
    series: bookingSeries(leads, range, tz),
    stages,
    winRate: won + lost ? won / (won + lost) : null,
  };
}

/** What the pipeline looks like right now, regardless of the date range. */
export function pipelineSnapshot(leads: Lead[], nowMs: number) {
  const weekAhead = nowMs + 7 * 86_400_000;
  const upcoming = leads
    .filter((l) => l.bookingStatus === "accepted" && Date.parse(l.startTime) > nowMs)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const open = leads.filter((l) => isLive(l) && OPEN_STAGES.includes(l.stage));
  return {
    upcoming,
    upcomingThisWeek: upcoming.filter((l) => Date.parse(l.startTime) <= weekAhead).length,
    pendingConfirmation: leads.filter((l) => l.bookingStatus === "pending" && Date.parse(l.startTime) > nowMs).length,
    open: open.length,
    openValue: sumValues(open),
    unpriced: open.filter((l) => leadValue(l) == null).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Formatting

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatMoney = (value: number) => usd.format(value);
export const formatMoneyCompact = (value: number) => (value < 10_000 ? usd.format(value) : usdCompact.format(value));
