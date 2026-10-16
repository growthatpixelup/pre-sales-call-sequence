import "server-only";

import { upsertFromBooking } from "@/lib/leads/store";
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
  eventType?: { slug?: string };
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
    meetingUrl: b.location && /^https?:\/\//.test(b.location) ? b.location : null,
    bookingStatus: toStatus(b.status),
    cancellationReason: b.cancellationReason ?? null,
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

/** Pulls existing bookings from the Cal.com API into the lead store. Returns how many were saved. */
export async function importBookingsFromCal(): Promise<number> {
  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) throw new Error("CAL_API_KEY is not set.");
  const eventTypeId = process.env.CAL_EVENT_TYPE_ID;

  let cursor: string | null | undefined;
  let count = 0;

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

    for (const booking of body.data) {
      await upsertFromBooking(bookingFromApi(booking), { source: "import", eventType: "imported" });
      count++;
    }

    cursor = body.pagination?.nextCursor;
    if (!body.pagination?.hasMore || !cursor) break;
  }

  return count;
}
