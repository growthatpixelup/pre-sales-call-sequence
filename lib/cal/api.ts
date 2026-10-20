import "server-only";

import { recordReschedules, removeLeads, upsertFromBooking } from "@/lib/leads/store";
import type { BookingInput, BookingStatus } from "@/lib/leads/types";

const CAL_API_BASE = "https://api.cal.com/v2";
const CAL_API_VERSION = "2026-05-01";
const MAX_PAGES = 20;

interface ApiAttendee {
  name?: string;
  email?: string;
  timeZone?: string;
  phoneNumber?: string;
}

interface ApiBooking {
  uid: string;
  title?: string;
  status?: string;
  start: string;
  end: string;
  location?: string;
  cancellationReason?: string;
  createdAt?: string;
  /** Set on a booking that replaced an earlier one, and on the one it replaced. */
  rescheduledFromUid?: string;
  rescheduledToUid?: string;
  eventTypeId?: number;
  eventType?: { id?: number; slug?: string };
  attendees?: ApiAttendee[];
  bookingFieldsResponses?: Record<string, unknown>;
}

interface ApiResponse {
  status: string;
  data: ApiBooking[];
  pagination?: { nextCursor?: string | null; hasMore?: boolean };
  error?: { message?: string };
}

function toStatus(value: string | undefined): BookingStatus {
  switch (value) {
    case "cancelled":
    case "rejected":
    case "pending":
      return value;
    case "awaiting_host":
      return "pending";
    default:
      return "accepted";
  }
}

function bookingFromApi(b: ApiBooking): BookingInput {
  const attendee = b.attendees?.[0];
  return {
    id: b.uid,
    startTime: b.start,
    endTime: b.end,
    timeZone: attendee?.timeZone ?? null,
    eventTitle: b.title ?? null,
    eventSlug: b.eventType?.slug ?? null,
    eventTypeId: b.eventTypeId ?? b.eventType?.id ?? null,
    meetingUrl: b.location && /^https?:\/\//.test(b.location) ? b.location : null,
    bookingStatus: toStatus(b.status),
    cancellationReason: b.cancellationReason ?? null,
    bookedAt: b.createdAt ?? null,
    attendeeName: attendee?.name ?? null,
    attendeeEmail: attendee?.email ?? null,
    attendeePhone: attendee?.phoneNumber ?? null,
    fields: Object.entries(b.bookingFieldsResponses ?? {}).map(([key, value]) => ({
      key,
      label: null,
      value,
    })),
  };
}

/**
 * Pulls existing bookings from the Cal.com API into the lead store. Returns how many were saved.
 * Cal.com treats a reschedule as cancel-and-rebook, so each chain of reschedules is saved once,
 * as its latest booking, booked at the time of the first.
 */
export async function importBookingsFromCal(): Promise<number> {
  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) throw new Error("CAL_API_KEY is not set.");
  const eventTypeId = process.env.CAL_EVENT_TYPE_ID;

  const bookings: ApiBooking[] = [];
  let cursor: string | null | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${CAL_API_BASE}/bookings`);
    url.searchParams.set("limit", "100");
    if (eventTypeId) url.searchParams.set("eventTypeId", eventTypeId);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, "cal-api-version": CAL_API_VERSION },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as ApiResponse | null;
    if (!res.ok || !body || body.status !== "success") {
      throw new Error(body?.error?.message ?? `Cal.com API returned ${res.status}`);
    }
    bookings.push(...body.data);

    cursor = body.pagination?.nextCursor;
    if (!body.pagination?.hasMore || !cursor) break;
  }

  const byUid = new Map(bookings.map((b) => [b.uid, b]));
  let count = 0;
  for (const booking of bookings) {
    // Replaced by a later booking we also have: that one carries the lead.
    if (booking.rescheduledToUid && byUid.has(booking.rescheduledToUid)) continue;

    const earlier = rescheduledFrom(booking, byUid);
    const input = bookingFromApi(booking);
    const first = earlier[earlier.length - 1];
    if (first?.createdAt) input.bookedAt = first.createdAt;

    await upsertFromBooking(input, {
      source: "import",
      eventType: "imported",
      previousIds: earlier.map((b) => b.uid),
    });
    // Leads saved for the replaced bookings by earlier imports are duplicates of this one.
    await removeLeads(earlier.map((b) => b.uid));
    await recordReschedules(
      booking.uid,
      earlier.map((b) => b.start),
    );
    count++;
  }

  return count;
}

/** The bookings this one replaced, newest first. */
function rescheduledFrom(booking: ApiBooking, byUid: Map<string, ApiBooking>): ApiBooking[] {
  const chain: ApiBooking[] = [];
  const seen = new Set([booking.uid]);
  let uid = booking.rescheduledFromUid;
  while (uid && !seen.has(uid)) {
    seen.add(uid);
    const previous = byUid.get(uid);
    if (!previous) break;
    chain.push(previous);
    uid = previous.rescheduledFromUid;
  }
  return chain;
}
