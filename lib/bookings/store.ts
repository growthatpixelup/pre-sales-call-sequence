import "server-only";

import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { bookingToLeadFields } from "./fields";
import { isInternal } from "./internal";
import type { Booking, BookingEvent, BookingInput, BookingLead, BookingStatus, EmailSettings } from "./types";

/**
 * Cal.com booking storage: tables `bookings` and `booking_events` (supabase/schema.sql, renamed in
 * migration 009). Each booking links to a GTM OS lead (`lead_id`), joined in as `lead`.
 */

interface BookingRow {
  id: string;
  name: string;
  email: string;
  business_name: string | null;
  business_website: string | null;
  problem: string | null;
  booking_reason: string | null;
  capital_raised: string | null;
  investment_range: string | null;
  referral_source: string | null;
  extra_fields: Booking["extraFields"];
  // Old booking form; never written for new bookings.
  phone: string | null;
  topic: string | null;
  notes: string | null;
  budget: string | null;
  twitter: string | null;
  start_time: string;
  end_time: string;
  time_zone: string | null;
  event_title: string | null;
  event_slug: string | null;
  event_type_id: number | null;
  email_settings: EmailSettings | null;
  meeting_url: string | null;
  booking_status: BookingStatus;
  cancellation_reason: string | null;
  booked_at: string;
  lead_id: string | null;
  // Joined from `leads` (see SELECT).
  lead?: {
    id: string;
    stage: BookingLead["stage"];
    stage_changed_at: string | null;
    estimated_price: number | string | null;
    closed_price: number | string | null;
  } | null;
  source: Booking["source"];
  created_at: string;
  updated_at: string;
}

interface EventRow {
  type: string;
  detail: string | null;
  at: string;
}

/** Booking columns plus the lead fields bookings show. */
const SELECT = "*, lead:leads(id, stage, stage_changed_at, estimated_price, closed_price)";

function fromRow(row: BookingRow, events: EventRow[] = []): Booking {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    businessName: row.business_name,
    businessWebsite: row.business_website,
    problem: row.problem,
    bookingReason: row.booking_reason,
    capitalRaised: row.capital_raised,
    investmentRange: row.investment_range,
    referralSource: row.referral_source,
    extraFields: row.extra_fields ?? [],
    legacy: {
      phone: row.phone,
      topic: row.topic,
      notes: row.notes,
      budget: row.budget,
      twitter: row.twitter,
    },
    startTime: row.start_time,
    endTime: row.end_time,
    timeZone: row.time_zone,
    eventTitle: row.event_title,
    eventSlug: row.event_slug,
    eventTypeId: row.event_type_id,
    meetingUrl: row.meeting_url,
    bookingStatus: row.booking_status,
    cancellationReason: row.cancellation_reason,
    // Leads saved before migration 005 have no booked_at.
    bookedAt: row.booked_at ?? row.created_at,
    leadId: row.lead_id,
    lead: row.lead
      ? {
          id: row.lead.id,
          stage: row.lead.stage,
          stageChangedAt: row.lead.stage_changed_at,
          // Postgres numerics can arrive as strings.
          estimatedPrice: row.lead.estimated_price == null ? null : Number(row.lead.estimated_price),
          closedPrice: row.lead.closed_price == null ? null : Number(row.lead.closed_price),
        }
      : null,
    emailSettings: row.email_settings ?? {},
    events: events.map((e): BookingEvent => ({ type: e.type, at: e.at, ...(e.detail ? { detail: e.detail } : {}) })),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Columns that come from Cal.com and are refreshed on every booking update. */
function calColumns(booking: BookingInput) {
  const f = bookingToLeadFields(booking);
  return {
    name: f.name,
    email: f.email,
    business_name: f.businessName,
    business_website: f.businessWebsite,
    problem: f.problem,
    booking_reason: f.bookingReason,
    capital_raised: f.capitalRaised,
    investment_range: f.investmentRange,
    referral_source: f.referralSource,
    extra_fields: f.extraFields,
    start_time: f.startTime,
    end_time: f.endTime,
    time_zone: f.timeZone,
    event_title: f.eventTitle,
    event_slug: f.eventSlug,
    // Keep a known event type if this payload doesn't carry one.
    ...(f.eventTypeId != null ? { event_type_id: f.eventTypeId } : {}),
    meeting_url: f.meetingUrl,
    booking_status: f.bookingStatus,
    cancellation_reason: f.cancellationReason,
  };
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`Supabase: could not ${action}: ${error.message}`);
}

async function addEvent(bookingId: string, type: string, detail?: string | null) {
  const { error } = await supabase()
    .from("booking_events")
    .insert({ booking_id: bookingId, type, detail: detail ?? null });
  if (error) fail("record lead event", error);
}

async function exists(id: string) {
  return Boolean(await bookedAtOf(id));
}

/** The lead's booked_at, or null if there's no such lead. */
async function bookedAtOf(id: string): Promise<string | null> {
  const { data, error } = await supabase().from("bookings").select("booked_at").eq("id", id).maybeSingle();
  if (error) fail("look up lead", error);
  return data ? (data.booked_at as string) : null;
}

/** All leads, latest call first. Our own and test bookings are left out (see ./internal). */
export async function listBookings(): Promise<Booking[]> {
  const { data, error } = await supabase()
    .from("bookings")
    .select(SELECT)
    .order("start_time", { ascending: false });
  if (error) fail("list leads", error);
  return (data as BookingRow[]).map((row) => fromRow(row)).filter((lead) => !isInternal(lead));
}

export async function getBooking(id: string): Promise<Booking | null> {
  const db = supabase();
  const [lead, events] = await Promise.all([
    db.from("bookings").select(SELECT).eq("id", id).maybeSingle(),
    db.from("booking_events").select("type, detail, at").eq("booking_id", id).order("at"),
  ]);
  if (lead.error) fail("load lead", lead.error);
  if (events.error) fail("load lead history", events.error);
  return lead.data ? fromRow(lead.data as BookingRow, events.data as EventRow[]) : null;
}

/**
 * Creates or updates a lead from a Cal.com booking. Dashboard-owned columns (stage, internal
 * notes, history) are never overwritten. Pass `previousId` for a reschedule so the old
 * booking's lead moves to the new booking uid; `previousIds` tries several, newest first.
 * Returns true if a new lead was created.
 */
export async function upsertFromBooking(
  booking: BookingInput,
  opts: { source: Booking["source"]; eventType: string; previousId?: string | null; previousIds?: string[] },
): Promise<boolean> {
  const db = supabase();
  const columns: Partial<BookingRow> = calColumns(booking);

  let bookedAt = await bookedAtOf(booking.id);

  const previousIds = [...(opts.previousId ? [opts.previousId] : []), ...(opts.previousIds ?? [])];
  for (const previousId of previousIds) {
    if (bookedAt) break;
    bookedAt = await bookedAtOf(previousId);
    if (bookedAt) {
      // lead_events and lead_emails follow via "on update cascade".
      const { error } = await db.from("bookings").update({ id: booking.id }).eq("id", previousId);
      if (error) fail("move rescheduled lead", error);
    }
  }

  // The first booking time wins: a reschedule is a new Cal.com booking with a later createdAt.
  if (booking.bookedAt && (!bookedAt || Date.parse(booking.bookedAt) < Date.parse(bookedAt))) {
    columns.booked_at = booking.bookedAt;
  }

  if (!bookedAt) {
    const { error } = await db.from("bookings").insert({ id: booking.id, ...columns, source: opts.source });
    if (!error) {
      await addEvent(booking.id, opts.eventType);
      return true;
    }
    // 23505 = unique violation: a duplicate delivery inserted it first, so update instead.
    if (error.code !== "23505") fail("save lead", error);
  }

  const { error } = await db.from("bookings").update(columns).eq("id", booking.id);
  if (error) fail("update lead", error);
  // Re-importing an existing booking isn't news; webhook updates are.
  if (opts.source !== "import") await addEvent(booking.id, opts.eventType);
  return false;
}

const RESCHEDULED = "booking_rescheduled";

/** Notes each earlier call a lead moved from (by its start time), once. */
export async function recordReschedules(bookingId: string, previousStarts: string[]): Promise<void> {
  if (!previousStarts.length) return;
  const db = supabase();
  const { data, error } = await db.from("booking_events").select("detail").eq("booking_id", bookingId).eq("type", RESCHEDULED);
  if (error) fail("load lead events", error);
  const known = new Set((data as { detail: string | null }[]).map((e) => e.detail));
  for (const start of previousStarts) {
    const detail = `Moved from a call on ${formatDateTime(start)}`;
    if (!known.has(detail)) await addEvent(bookingId, RESCHEDULED, detail);
  }
}

/** How many times each lead's call was rescheduled. */
export async function rescheduleCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase().from("booking_events").select("booking_id").eq("type", RESCHEDULED);
  if (error) fail("load reschedules", error);
  const counts = new Map<string, number>();
  for (const { booking_id } of data as { booking_id: string }[]) counts.set(booking_id, (counts.get(booking_id) ?? 0) + 1);
  return counts;
}

export type LinkedInOutcome = "linkedin_sent" | "linkedin_skipped";

/** Records that the LinkedIn connect note was sent (or skipped) for a lead. */
export async function recordLinkedIn(bookingId: string, outcome: LinkedInOutcome): Promise<void> {
  await addEvent(bookingId, outcome);
}

/** Leads whose LinkedIn note was sent or skipped, with which. */
export async function linkedInOutcomes(): Promise<Map<string, LinkedInOutcome>> {
  const { data, error } = await supabase()
    .from("booking_events")
    .select("booking_id, type")
    .in("type", ["linkedin_sent", "linkedin_skipped"])
    .order("at");
  if (error) fail("load LinkedIn notes", error);
  return new Map((data as { booking_id: string; type: LinkedInOutcome }[]).map((e) => [e.booking_id, e.type]));
}

/** Deletes leads (their events and emails go with them; replies are kept, unlinked). */
export async function removeBookings(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase().from("bookings").delete().in("id", ids);
  if (error) fail("remove leads", error);
}

/** Returns false if no lead with this id exists. */
export async function setBookingStatus(
  id: string,
  status: BookingStatus,
  eventType: string,
  detail?: string | null,
): Promise<boolean> {
  const changes: Partial<BookingRow> = { booking_status: status };
  if (status === "cancelled" || status === "rejected") changes.cancellation_reason = detail ?? null;

  const { data, error } = await supabase().from("bookings").update(changes).eq("id", id).select("id");
  if (error) fail("update booking status", error);
  if (!data?.length) return false;
  await addEvent(id, eventType, detail);
  return true;
}

export async function addBookingEvent(id: string, type: string, detail?: string): Promise<void> {
  if (await exists(id)) await addEvent(id, type, detail);
}

export async function updateEmailSettings(id: string, settings: EmailSettings): Promise<void> {
  const { error } = await supabase().from("bookings").update({ email_settings: settings }).eq("id", id);
  if (error) fail("save email settings", error);
}

/** Points a booking at its lead. */
export async function setBookingLead(bookingId: string, leadId: string): Promise<void> {
  const { error } = await supabase().from("bookings").update({ lead_id: leadId }).eq("id", bookingId);
  if (error) fail("link booking to lead", error);
}

/** A lead's bookings, latest call first. */
export async function listBookingsForLead(leadId: string): Promise<Booking[]> {
  const { data, error } = await supabase()
    .from("bookings")
    .select(SELECT)
    .eq("lead_id", leadId)
    .order("start_time", { ascending: false });
  if (error) fail("list a lead's bookings", error);
  return (data as BookingRow[]).map((row) => fromRow(row));
}
