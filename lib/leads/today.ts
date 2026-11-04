import "server-only";

import { dashboardTimeZone } from "@/lib/analytics";
import { listBookings } from "@/lib/bookings/store";
import type { Booking } from "@/lib/bookings/types";
import { addDays, localDate } from "@/lib/emails/time";
import { loadTasks } from "@/lib/tasks";
import { listLeads } from "./store";
import { isOpen, type Lead } from "./types";

/** A lead this quiet is flagged. */
export const SILENT_DAYS = 5;

const DAY_MS = 86_400_000;

/** Whole days from `iso` to now. */
export const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / DAY_MS);

/**
 * Everything for the Today view: what needs doing now, across the pipeline. Days are calendar
 * days in DASHBOARD_TIMEZONE.
 */
export async function loadToday(now: Date) {
  const nowMs = now.getTime();
  const tz = dashboardTimeZone();
  const today = localDate(now, tz);
  const [leads, bookings, { tasks }] = await Promise.all([listLeads(), listBookings(), loadTasks(now)]);
  const leadsById = new Map(leads.map((l) => [l.id, l]));

  const live = (b: Booking) => b.bookingStatus === "accepted" || b.bookingStatus === "pending";
  const callsToday = bookings
    .filter((b) => live(b) && localDate(new Date(b.startTime), tz) === today)
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  // Leads waiting on a call that's still ahead aren't silent: the call is the next touch.
  const callAhead = new Set(
    bookings.filter((b) => b.leadId && live(b) && Date.parse(b.endTime) > nowMs).map((b) => b.leadId as string),
  );

  const open = leads.filter(isOpen);
  const nextActions = open
    .filter((l) => l.nextActionDue && l.nextActionDue <= today)
    .sort((a, b) => (a.nextActionDue! < b.nextActionDue! ? -1 : 1));
  const silent = open
    .filter((l) => !callAhead.has(l.id) && l.stage !== "proposal_sent")
    .filter((l) => daysSince(l.lastTouchAt ?? l.createdAt, nowMs) >= SILENT_DAYS)
    .sort((a, b) => Date.parse(a.lastTouchAt ?? a.createdAt) - Date.parse(b.lastTouchAt ?? b.createdAt));
  const proposals = leads
    .filter((l) => l.stage === "proposal_sent")
    .sort((a, b) => Date.parse(a.stageChangedAt ?? a.updatedAt) - Date.parse(b.stageChangedAt ?? b.updatedAt));

  return {
    today,
    tomorrow: addDays(today, 1),
    callsToday: callsToday.map((booking) => ({ booking, lead: booking.leadId ? leadsById.get(booking.leadId) ?? null : null })),
    emailTasks: tasks.filter((t) => t.kind === "email"),
    linkedInTasks: tasks.filter((t) => t.kind === "linkedin"),
    stuckEmails: tasks.filter((t) => t.kind === "failed" || t.kind === "overdue" || t.kind === "unscheduled"),
    nextActions,
    silent,
    proposals,
  };
}

export type TodayView = Awaited<ReturnType<typeof loadToday>>;
export type { Lead };
