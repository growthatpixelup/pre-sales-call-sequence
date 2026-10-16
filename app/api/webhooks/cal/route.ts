import { bookingFromWebhook, previousBookingUid, verifyCalSignature } from "@/lib/cal/webhook";
import { addLeadEvent, setBookingStatus, upsertFromBooking } from "@/lib/leads/store";

type Json = Record<string, unknown>;

export async function POST(request: Request) {
  // The signature covers the exact bytes Cal.com sent, so read the raw body before parsing.
  const rawBody = await request.text();
  const secret = process.env.CAL_WEBHOOK_SECRET;

  if (secret) {
    if (!verifyCalSignature(rawBody, request.headers.get("x-cal-signature-256"), secret)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "CAL_WEBHOOK_SECRET is not configured" }, { status: 500 });
  }

  let body: Json;
  try {
    body = JSON.parse(rawBody) as Json;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const trigger = String(body.triggerEvent ?? "");
  // MEETING_STARTED / MEETING_ENDED send booking fields at the top level instead of in `payload`.
  const payload = (body.payload ?? body) as Json;

  switch (trigger) {
    case "PING":
      return Response.json({ ok: true });

    case "BOOKING_CREATED":
    case "BOOKING_REQUESTED":
    case "BOOKING_RESCHEDULED": {
      const booking = bookingFromWebhook(
        payload,
        trigger === "BOOKING_REQUESTED" ? "pending" : "accepted",
      );
      if (!booking) return Response.json({ error: "Missing booking uid" }, { status: 400 });
      await upsertFromBooking(booking, {
        source: "webhook",
        eventType: trigger.toLowerCase(),
        previousId: trigger === "BOOKING_RESCHEDULED" ? previousBookingUid(payload) : null,
      });
      break;
    }

    case "BOOKING_CANCELLED":
    case "BOOKING_REJECTED": {
      const status = trigger === "BOOKING_CANCELLED" ? "cancelled" : "rejected";
      const booking = bookingFromWebhook(payload, status);
      if (!booking) return Response.json({ error: "Missing booking uid" }, { status: 400 });
      const reason = (payload.cancellationReason ?? payload.rejectionReason) as string | undefined;
      const updated = await setBookingStatus(booking.id, status, trigger.toLowerCase(), reason);
      // A cancellation for a booking we never saw (e.g. made before the webhook existed).
      if (!updated) {
        await upsertFromBooking(
          { ...booking, bookingStatus: status },
          { source: "webhook", eventType: trigger.toLowerCase() },
        );
      }
      break;
    }

    default: {
      // Anything else (MEETING_ENDED, BOOKING_NO_SHOW_UPDATED, ...) is recorded on the lead's history.
      const uid = (payload.uid ?? payload.bookingUid) as string | undefined;
      if (uid) await addLeadEvent(uid, trigger.toLowerCase());
    }
  }

  return Response.json({ ok: true });
}
