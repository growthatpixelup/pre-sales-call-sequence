import "server-only";

import { supabase } from "@/lib/supabase";
import { bookingToLeadFields } from "./fields";
import type { BookingInput, BookingStatus, Lead, LeadEvent, LeadStage } from "./types";

/**
 * Lead storage backed by Supabase (tables `leads` and `lead_events`, see supabase/schema.sql).
 */

interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  topic: string | null;
  notes: string | null;
  budget: string | null;
  twitter: string | null;
  extra_fields: Lead["extraFields"];
  start_time: string;
  end_time: string;
  time_zone: string | null;
  event_title: string | null;
  event_slug: string | null;
  meeting_url: string | null;
  booking_status: BookingStatus;
  cancellation_reason: string | null;
  stage: LeadStage;
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
    phone: row.phone,
    topic: row.topic,
    notes: row.notes,
    budget: row.budget,
    twitter: row.twitter,
    extraFields: row.extra_fields ?? [],
    startTime: row.start_time,
    endTime: row.end_time,
    timeZone: row.time_zone,
    eventTitle: row.event_title,
    eventSlug: row.event_slug,
    meetingUrl: row.meeting_url,
    bookingStatus: row.booking_status,
    cancellationReason: row.cancellation_reason,
    stage: row.stage,
    internalNotes: row.internal_notes,
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
    phone: f.phone,
    topic: f.topic,
    notes: f.notes,
    budget: f.budget,
    twitter: f.twitter,
    extra_fields: f.extraFields,
    start_time: f.startTime,
    end_time: f.endTime,
    time_zone: f.timeZone,
    event_title: f.eventTitle,
    event_slug: f.eventSlug,
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
  const { data, error } = await supabase().from("leads").select("id").eq("id", id).maybeSingle();
  if (error) fail("look up lead", error);
  return Boolean(data);
}

export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabase()
    .from("leads")
    .select("*")
    .order("start_time", { ascending: false });
  if (error) fail("list leads", error);
  return (data as LeadRow[]).map((row) => fromRow(row));
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
 * booking's lead moves to the new booking uid.
 */
export async function upsertFromBooking(
  booking: BookingInput,
  opts: { source: Lead["source"]; eventType: string; previousId?: string | null },
): Promise<void> {
  const db = supabase();
  const columns = calColumns(booking);

  let found = await exists(booking.id);

  if (!found && opts.previousId && (await exists(opts.previousId))) {
    // lead_events follow via "on update cascade".
    const { error } = await db.from("leads").update({ id: booking.id }).eq("id", opts.previousId);
    if (error) fail("move rescheduled lead", error);
    found = true;
  }

  if (!found) {
    const { error } = await db.from("leads").insert({ id: booking.id, ...columns, source: opts.source });
    if (!error) {
      await addEvent(booking.id, opts.eventType);
      return;
    }
    // 23505 = unique violation: a duplicate delivery inserted it first, so update instead.
    if (error.code !== "23505") fail("save lead", error);
  }

  const { error } = await db.from("leads").update(columns).eq("id", booking.id);
  if (error) fail("update lead", error);
  // Re-importing an existing booking isn't news; webhook updates are.
  if (opts.source !== "import") await addEvent(booking.id, opts.eventType);
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

export async function updateLeadTracking(
  id: string,
  changes: { stage?: LeadStage; internalNotes?: string },
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
      previousStage = data.stage as LeadStage;
    }
  }
  if (changes.internalNotes !== undefined) update.internal_notes = changes.internalNotes;
  if (!Object.keys(update).length) return;

  const { error } = await db.from("leads").update(update).eq("id", id);
  if (error) fail("update lead", error);
  if (previousStage) await addEvent(id, "stage_changed", `${previousStage} → ${changes.stage}`);
}
