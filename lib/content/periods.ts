/** Reporting periods for Content OS analytics. Days are "YYYY-MM-DD" in the dashboard time zone. */

export const PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "28d", label: "28 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "This year" },
  { value: "12m", label: "12 months" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];
export const DEFAULT_PERIOD: Period = "28d";

export function parsePeriod(value: string | undefined): Period {
  return PERIODS.some((p) => p.value === value) ? (value as Period) : DEFAULT_PERIOD;
}

const DAY_MS = 86_400_000;
const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const shiftDays = (ymd: string, n: number) => fromMs(toMs(ymd) + n * DAY_MS);
/** Days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY_MS);
/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (ymd: string) => (new Date(toMs(ymd)).getUTCDay() + 6) % 7;

export interface DayRange {
  from: string;
  to: string;
}

export interface PeriodRange extends DayRange {
  days: number;
  /** The same number of days just before. */
  previous: DayRange;
  unit: "day" | "week" | "month";
}

export function resolvePeriod(period: Period, today: string): PeriodRange {
  const from =
    period === "ytd"
      ? `${today.slice(0, 4)}-01-01`
      : shiftDays(today, -({ "7d": 7, "28d": 28, "90d": 90, "12m": 365 }[period] - 1));
  const days = daysBetween(from, today) + 1;
  const prevTo = shiftDays(from, -1);
  return {
    from,
    to: today,
    days,
    previous: { from: shiftDays(prevTo, -(days - 1)), to: prevTo },
    unit: days <= 31 ? "day" : days <= 120 ? "week" : "month",
  };
}

export interface Bucket extends DayRange {
  label: string;
}

const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Splits a range into days, 7-day weeks (from the start) or calendar months. */
export function buckets(range: DayRange, unit: PeriodRange["unit"]): Bucket[] {
  const out: Bucket[] = [];
  let from = range.from;
  while (from <= range.to) {
    let to: string;
    if (unit === "day") to = from;
    else if (unit === "week") to = shiftDays(from, 6);
    else {
      const d = new Date(toMs(from));
      to = fromMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    }
    if (to > range.to) to = range.to;
    const label =
      unit === "month" ? month.format(new Date(toMs(from))) : short.format(new Date(toMs(from)));
    out.push({ from, to, label });
    from = shiftDays(to, 1);
  }
  return out;
}

export const inRange = (ymd: string, r: DayRange) => ymd >= r.from && ymd <= r.to;
