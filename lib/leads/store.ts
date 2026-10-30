import "server-only";

import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { bookingToLeadFields } from "./fields";
import { isInternal } from "./internal";
import type { BookingInput, BookingStatus, EmailSettings, Lead, LeadEvent, LeadStage } from "./types";

/**
 * Lead storage backed by Supabase (tables `leads` and `lead_events`, see supabase/schema.sql).
 */

interface LeadRow {
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
  extra_fields: Lead["extraFields"];
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
  stage: LeadStage;
  stage_changed_at: string | null;
  deal_value: number | string | null;
  internal_notes: string;
  source: Lead["source"];
  created_at: string;
  updated_at: string;
}

interface EventRow {
  type: string;
  detail: string | null;
  at: string;
}

function fromRow(row: LeadRow, events: EventRow[] = []): Lead {
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
    stage: row.stage,
    stageChangedAt: row.stage_changed_at,
    // Postgres numerics can arrive as strings.
    dealValue: row.deal_value == null ? null : Number(row.deal_value),
    internalNotes: row.internal_notes,
    emailSettings: row.email_settings ?? {},
    events: events.map((e): LeadEvent => ({ type: e.type, at: e.at, ...(e.detail ? { detail: e.detail } : {}) })),
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

async function addEvent(leadId: string, type: string, detail?: string | null) {
  const { error } = await supabase()
    .from("lead_events")
    .insert({ lead_id: leadId, type, detail: detail ?? null });
  if (error) fail("record lead event", error);
}

async function exists(id: string) {
  return Boolean(await bookedAtOf(id));
}

/** The lead's booked_at, or null if there's no such lead. */
async function bookedAtOf(id: string): Promise<string | null> {
  const { data, error } = await supabase().from("leads").select("booked_at").eq("id", id).maybeSingle();
  if (error) fail("look up lead", error);
  return data ? (data.booked_at as string) : null;
}

/** All leads, latest call first. Our own and test bookings are left out (see ./internal). */
export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabase()
    .from("leads")
    .select("*")
    .order("start_time", { ascending: false });
  if (error) fail("list leads", error);
  return (data as LeadRow[]).map((row) => fromRow(row)).filter((lead) => !isInternal(lead));
}

export async function getLead(id: string): Promise<Lead | null> {
  const db = supabase();
  const [lead, events] = await Promise.all([
    db.from("leads").select("*").eq("id", id).maybeSingle(),
    db.from("lead_events").select("type, detail, at").eq("lead_id", id).order("at"),
  ]);
  if (lead.error) fail("load lead", lead.error);
  if (events.error) fail("load lead history", events.error);
  return lead.data ? fromRow(lead.data as LeadRow, events.data as EventRow[]) : null;
}

/**
 * Creates or updates a lead from a Cal.com booking. Dashboard-owned columns (stage, internal
 * notes, history) are never overwritten. Pass `previousId` for a reschedule so the old
 * booking's lead moves to the new booking uid; `previousIds` tries several, newest first.
 * Returns true if a new lead was created.
 */
export async function upsertFromBooking(
  booking: BookingInput,
  opts: { source: Lead["source"]; eventType: string; previousId?: string | null; previousIds?: string[] },
): Promise<boolean> {
  const db = supabase();
  const columns: Partial<LeadRow> = calColumns(booking);

  let bookedAt = await bookedAtOf(booking.id);

  const previousIds = [...(opts.previousId ? [opts.previousId] : []), ...(opts.previousIds ?? [])];
  for (const previousId of previousIds) {
    if (bookedAt) break;
    bookedAt = await bookedAtOf(previousId);
    if (bookedAt) {
      // lead_events and lead_emails follow via "on update cascade".
      const { error } = await db.from("leads").update({ id: booking.id }).eq("id", previousId);
      if (error) fail("move rescheduled lead", error);
    }
  }

  // The first booking time wins: a reschedule is a new Cal.com booking with a later createdAt.
  if (booking.bookedAt && (!bookedAt || Date.parse(booking.bookedAt) < Date.parse(bookedAt))) {
    columns.booked_at = booking.bookedAt;
  }

  if (!bookedAt) {
    const { error } = await db.from("leads").insert({ id: booking.id, ...columns, source: opts.source });
    if (!error) {
      await addEvent(booking.id, opts.eventType);
      return true;
    }
    // 23505 = unique violation: a duplicate delivery inserted it first, so update instead.
    if (error.code !== "23505") fail("save lead", error);
  }

  const { error } = await db.from("leads").update(columns).eq("id", booking.id);
  if (error) fail("update lead", error);
  // Re-importing an existing booking isn't news; webhook updates are.
  if (opts.source !== "import") await addEvent(booking.id, opts.eventType);
  return false;
}

const RESCHEDULED = "booking_rescheduled";

/** Notes each earlier call a lead moved from (by its start time), once. */
export async function recordReschedules(leadId: string, previousStarts: string[]): Promise<void> {
  if (!previousStarts.length) return;
  const db = supabase();
  const { data, error } = await db.from("lead_events").select("detail").eq("lead_id", leadId).eq("type", RESCHEDULED);
  if (error) fail("load lead events", error);
  const known = new Set((data as { detail: string | null }[]).map((e) => e.detail));
  for (const start of previousStarts) {
    const detail = `Moved from a call on ${formatDateTime(start)}`;
    if (!known.has(detail)) await addEvent(leadId, RESCHEDULED, detail);
  }
}

/** How many times each lead's call was rescheduled. */
export async function rescheduleCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase().from("lead_events").select("lead_id").eq("type", RESCHEDULED);
  if (error) fail("load reschedules", error);
  const counts = new Map<string, number>();
  for (const { lead_id } of data as { lead_id: string }[]) counts.set(lead_id, (counts.get(lead_id) ?? 0) + 1);
  return counts;
}

export type LinkedInOutcome = "linkedin_sent" | "linkedin_skipped";

/** Records that the LinkedIn connect note was sent (or skipped) for a lead. */
export async function recordLinkedIn(leadId: string, outcome: LinkedInOutcome): Promise<void> {
  await addEvent(leadId, outcome);
}

/** Leads whose LinkedIn note was sent or skipped, with which. */
export async function linkedInOutcomes(): Promise<Map<string, LinkedInOutcome>> {
  const { data, error } = await supabase()
    .from("lead_events")
    .select("lead_id, type")
    .in("type", ["linkedin_sent", "linkedin_skipped"])
    .order("at");
  if (error) fail("load LinkedIn notes", error);
  return new Map((data as { lead_id: string; type: LinkedInOutcome }[]).map((e) => [e.lead_id, e.type]));
}

/** Deletes leads (their events and emails go with them; replies are kept, unlinked). */
export async function removeLeads(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase().from("leads").delete().in("id", ids);
  if (error) fail("remove leads", error);
}

/** Returns false if no lead with this id exists. */
export async function setBookingStatus(
  id: string,
  status: BookingStatus,
  eventType: string,
  detail?: string | null,
): Promise<boolean> {
  const changes: Partial<LeadRow> = { booking_status: status };
  if (status === "cancelled" || status === "rejected") changes.cancellation_reason = detail ?? null;

  const { data, error } = await supabase().from("leads").update(changes).eq("id", id).select("id");
  if (error) fail("update booking status", error);
  if (!data?.length) return false;
  await addEvent(id, eventType, detail);
  return true;
}

export async function addLeadEvent(id: string, type: string, detail?: string): Promise<void> {
  if (await exists(id)) await addEvent(id, type, detail);
}

export async function updateEmailSettings(id: string, settings: EmailSettings): Promise<void> {
  const { error } = await supabase().from("leads").update({ email_settings: settings }).eq("id", id);
  if (error) fail("save email settings", error);
}

export async function updateLeadTracking(
  id: string,
  changes: { stage?: LeadStage; internalNotes?: string; dealValue?: number | null },
): Promise<void> {
  const db = supabase();
  const update: Partial<LeadRow> = {};
  let previousStage: LeadStage | null = null;

  if (changes.stage) {
    const { data, error } = await db.from("leads").select("stage").eq("id", id).maybeSingle();
    if (error) fail("load lead", error);
    if (!data) return;
    if (data.stage !== changes.stage) {
      update.stage = changes.stage;
      update.stage_changed_at = new Date().toISOString();
      previousStage = data.stage as LeadStage;
    }
  }
  if (changes.internalNotes !== undefined) update.internal_notes = changes.internalNotes;
  if (changes.dealValue !== undefined) update.deal_value = changes.dealValue;
  if (!Object.keys(update).length) return;

  const { error } = await db.from("leads").update(update).eq("id", id);
  if (error) fail("update lead", error);
  if (previousStage) await addEvent(id, "stage_changed", `${previousStage} → ${changes.stage}`);
}
