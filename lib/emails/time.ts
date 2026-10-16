/** Time zone helpers. Dates are plain `Date`s; "local" means in a given IANA time zone. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export { MINUTE, HOUR };

/** Returns `tz` if the runtime knows it, otherwise a safe fallback. */
export function safeTimeZone(tz: string | null | undefined): string {
  const candidates = [tz, process.env.DASHBOARD_TIMEZONE, "UTC"];
  for (const c of candidates) {
    if (!c) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: c });
      return c;
    } catch {
      // try the next one
    }
  }
  return "UTC";
}

function parts(date: Date, tz: string) {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Local calendar date as "YYYY-MM-DD". */
export function localDate(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localHour(date: Date, tz: string): number {
  return parts(date, tz).hour;
}

/** "YYYY-MM-DD" plus `n` days. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function offsetMs(date: Date, tz: string) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when it is `hour`:00 on `ymd` in `tz`. */
export function atLocalTime(ymd: string, hour: number, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const wallClock = Date.UTC(y, m - 1, d, hour);
  // Two passes so the offset is right on DST change days.
  let t = wallClock - offsetMs(new Date(wallClock), tz);
  t = wallClock - offsetMs(new Date(t), tz);
  return new Date(t);
}

function fmt(date: Date, tz: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...options }).format(date);
}

/** "Monday" */
export const formatWeekday = (d: Date, tz: string) => fmt(d, tz, { weekday: "long" });
/** "Monday, October 19" */
export const formatDayDate = (d: Date, tz: string) =>
  fmt(d, tz, { weekday: "long", month: "long", day: "numeric" });
/** "10:30 AM" */
export const formatTime = (d: Date, tz: string) => fmt(d, tz, { hour: "numeric", minute: "2-digit" });

/** "India Standard Time", falling back to the zone id. */
export function formatZoneName(d: Date, tz: string): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  return name ?? tz;
}
