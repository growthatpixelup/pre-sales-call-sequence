import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { BookingInput, BookingStatus, RawField } from "@/lib/leads/types";

/** Checks the `x-cal-signature-256` header: a hex HMAC-SHA256 of the raw body. */
export function verifyCalSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toStatus(value: unknown, fallback: BookingStatus): BookingStatus {
  const s = typeof value === "string" ? value.toLowerCase() : "";
  if (s === "accepted" || s === "pending" || s === "cancelled" || s === "rejected") return s;
  if (s === "awaiting_host") return "pending";
  return fallback;
}

/** Normalises a webhook `payload` into a booking. Returns null if it has no booking uid. */
export function bookingFromWebhook(payload: Json, fallbackStatus: BookingStatus): BookingInput | null {
  const id = str(payload.uid);
  if (!id) return null;

  const attendee = (Array.isArray(payload.attendees) ? payload.attendees[0] : null) as Json | null;
  const responses = (payload.responses ?? {}) as Record<string, Json | unknown>;

  const fields: RawField[] = Object.entries(responses).map(([key, entry]) => {
    if (entry && typeof entry === "object" && "value" in (entry as Json)) {
      const e = entry as Json;
      return { key, label: str(e.label), value: e.value };
    }
    return { key, label: null, value: entry };
  });
  // Older payloads only include custom questions under `userFieldsResponses`.
  if (!fields.length && payload.userFieldsResponses) {
    for (const [key, entry] of Object.entries(payload.userFieldsResponses as Json)) {
      const e = (entry ?? {}) as Json;
      fields.push({ key, label: str(e.label), value: e.value });
    }
  }

  const metadata = (payload.metadata ?? {}) as Json;
  const videoCallData = (payload.videoCallData ?? {}) as Json;
  const location = str(payload.location);
  const eventType = (payload.eventType ?? {}) as Json;

  return {
    id,
    startTime: str(payload.startTime) ?? new Date().toISOString(),
    endTime: str(payload.endTime) ?? str(payload.startTime) ?? new Date().toISOString(),
    timeZone: str(attendee?.timeZone),
    eventTitle: str(payload.title),
    eventSlug: str(payload.type) ?? str(eventType.slug),
    eventTypeId: typeof payload.eventTypeId === "number" ? payload.eventTypeId : null,
    meetingUrl:
      str(metadata.videoCallUrl) ??
      str(videoCallData.url) ??
      (location && /^https?:\/\//.test(location) ? location : null),
    bookingStatus: toStatus(payload.status, fallbackStatus),
    cancellationReason: str(payload.cancellationReason),
    attendeeName: str(attendee?.name),
    attendeeEmail: str(attendee?.email),
    attendeePhone: str(attendee?.phoneNumber) ?? str(payload.smsReminderNumber),
    fields,
  };
}

/** Uid of the booking a reschedule replaced, if the payload says. */
export function previousBookingUid(payload: Json): string | null {
  const original = (payload.originalRescheduledBooking ?? {}) as Json;
  return str(payload.rescheduleUid) ?? str(payload.fromReschedule) ?? str(original.uid);
}
