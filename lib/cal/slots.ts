import "server-only";

import { addDays, localDate, safeTimeZone } from "@/lib/emails/time";

const SLOTS_API_VERSION = "2024-09-04";

/**
 * Two open slots on different days, at least 24 hours out, for the no-show
 * email's "does [Day] at [Time] or [Day] at [Time] work better?". Returns [] if Cal.com can't
 * be reached or there aren't two days with availability in the next two weeks.
 */
export async function nextTwoSlots(eventTypeId: number, timeZone: string | null): Promise<Date[]> {
  const tz = safeTimeZone(timeZone);
  const tomorrow = addDays(localDate(new Date(), tz), 1);
  const url = new URL("https://api.cal.com/v2/slots");
  url.searchParams.set("eventTypeId", String(eventTypeId));
  url.searchParams.set("start", tomorrow);
  url.searchParams.set("end", addDays(tomorrow, 14));
  url.searchParams.set("timeZone", tz);

  try {
    const headers: Record<string, string> = { "cal-api-version": SLOTS_API_VERSION };
    if (process.env.CAL_API_KEY) headers.Authorization = `Bearer ${process.env.CAL_API_KEY}`;
    const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Record<string, { start: string }[]> };
    const days = Object.keys(body.data ?? {}).sort();
    const earliest = Date.now() + 24 * 60 * 60_000;
    const picks: Date[] = [];
    for (const day of days) {
      const first = body.data?.[day]?.find((slot) => Date.parse(slot.start) >= earliest);
      if (first) picks.push(new Date(first.start));
      if (picks.length === 2) break;
    }
    return picks.length === 2 ? picks : [];
  } catch {
    return [];
  }
}
