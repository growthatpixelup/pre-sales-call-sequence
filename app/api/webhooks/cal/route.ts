import { bookingFromWebhook, previousBookingUid, verifyCalSignature } from "@/lib/cal/webhook";
import { cancelSequence, queueNoShowNudge, scheduleSequence } from "@/lib/emails/sender";
import { cancelPending } from "@/lib/emails/queue";
import { addLeadEvent, getLead, setBookingStatus, upsertFromBooking } from "@/lib/leads/store";

type Json = Record<string, unknown>;

/** Email problems are logged, not returned: the lead is already saved and Cal.com shouldn't retry. */
async function emailStep(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[cal webhook] ${label} failed:`, err);
  }
}

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
      await emailStep("scheduling emails", async () => {
        const lead = await getLead(booking.id);
        if (!lead) return;
        const rescheduled = trigger === "BOOKING_RESCHEDULED";
        if (rescheduled) await cancelPending(lead.id, "Call was rescheduled", ["no_show"]);
        await scheduleSequence(lead, { rescheduled });
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
      await emailStep("cancelling emails", () => cancelSequence(booking.id, `Booking was ${status}`));
      break;
    }

    // Cal Video reports the guest hadn't joined a few minutes after the start (the delay is set
    // on the webhook in Cal.com).
    case "AFTER_GUESTS_CAL_VIDEO_NO_SHOW": {
      const uid = payload.bookingUid as string | undefined;
      if (uid && (await getLead(uid))) {
        await addLeadEvent(uid, "guest_did_not_join");
        await emailStep("queueing no-show email", () => queueNoShowNudge(uid, "Guest hadn't joined Cal Video"));
      }
      break;
    }

    // Marked as a no-show in Cal.com. Only nudges while the call is still on (checked at send time).
    case "BOOKING_NO_SHOW_UPDATED": {
      const uid = payload.bookingUid as string | undefined;
      const attendees = (payload.attendees ?? []) as { noShow?: boolean }[];
      if (uid && (await getLead(uid))) {
        await addLeadEvent(uid, "booking_no_show_updated", payload.message as string | undefined);
        if (attendees.some((a) => a.noShow)) {
          await emailStep("queueing no-show email", () => queueNoShowNudge(uid, "Marked as no-show in Cal.com"));
        }
      }
      break;
    }

    default: {
      // Anything else (MEETING_ENDED, ...) is recorded on the lead's history.
      const uid = (payload.uid ?? payload.bookingUid) as string | undefined;
      if (uid) await addLeadEvent(uid, trigger.toLowerCase());
    }
  }

  return Response.json({ ok: true });
}
