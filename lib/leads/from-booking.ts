import "server-only";

import { estimatedValue } from "@/lib/analytics";
import { getBooking, setBookingLead } from "@/lib/bookings/store";
import { isInternal } from "@/lib/bookings/internal";
import type { Booking } from "@/lib/bookings/types";
import { formatDateTime } from "@/lib/format";
import { companyDomain } from "./dedup";
import { createLead, findMatchingLead, getLead, logActivity, setStage, touchLead, updateLead } from "./store";
import type { Stage } from "./types";

/** A new booking brings these leads (back) to Call booked. Later stages stay where they are. */
const BOOKING_ADVANCES: Stage[] = ["engaged", "no_show", "lost", "nurture"];

/**
 * Feeds a Cal.com booking into the pipeline: links it to the lead it belongs to (matched on email,
 * then company domain) or creates one at Call booked, and returns the lead id.
 *
 * `fresh` is true for a booking that just happened (webhook: created, requested, rescheduled). Only
 * then does it move an existing lead to Call booked; re-imports and cancellations just link.
 * Our own and test bookings get no lead.
 */
export async function attachBooking(bookingId: string, { fresh }: { fresh: boolean }): Promise<string | null> {
  const booking = await getBooking(bookingId);
  if (!booking || isInternal(booking)) return null;
  // Only a call that's still ahead moves the stage (sync can bring in old bookings).
  const live =
    (booking.bookingStatus === "accepted" || booking.bookingStatus === "pending") &&
    Date.parse(booking.endTime) > Date.now();
  const when = `Call on ${formatDateTime(booking.startTime)}`;

  // Already linked, and nothing new happened.
  if (booking.leadId && !fresh) return booking.leadId;

  let leadId = booking.leadId;
  if (!leadId) {
    const match = await findMatchingLead({
      email: booking.email,
      domain: companyDomain(booking.email, booking.businessWebsite),
    });
    if (match) {
      leadId = match.lead.id;
      await setBookingLead(booking.id, leadId);
      await logActivity(leadId, "booking", `${when} (matched on ${match.on})`, { at: booking.bookedAt, touch: true });
    } else {
      const lead = await createLead(
        {
          contactName: booking.name,
          company: booking.businessName,
          email: booking.email || null,
          origin: "cal",
          originDetail: booking.referralSource,
          bookingSource: booking.referralSource,
          estimatedPrice: estimatedValue(booking),
        },
        {
          stage: "call_booked",
          website: booking.businessWebsite,
          at: booking.bookedAt,
          activity: `Booked through Cal.com. ${when}`,
        },
      );
      await setBookingLead(booking.id, lead.id);
      return lead.id;
    }
  } else if (fresh) {
    await touchLead(leadId, booking.bookedAt);
  }

  const lead = await getLead(leadId);
  if (!lead) return leadId;

  // Fill what the booking knows and the lead doesn't yet.
  await updateLead(lead.id, {
    ...(lead.bookingSource == null && booking.referralSource ? { bookingSource: booking.referralSource } : {}),
    ...(lead.estimatedPrice == null && estimatedValue(booking) != null ? { estimatedPrice: estimatedValue(booking) } : {}),
    ...(!lead.company && booking.businessName ? { company: booking.businessName } : {}),
  });

  if (fresh && live && BOOKING_ADVANCES.includes(lead.stage)) {
    await setStage(lead.id, "call_booked", { by: "Cal booking" });
  }
  return lead.id;
}

/**
 * A reply to the pre-call sequence is a two-way touch on the booking's lead. (The reply itself
 * shows on the lead's timeline from the replies table.)
 */
export async function recordReplyOnLead(booking: Pick<Booking, "leadId">, at: string) {
  if (booking.leadId) await touchLead(booking.leadId, at);
}
