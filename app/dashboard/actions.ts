"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { syncBookingsFromCal } from "@/lib/cal/api";
import { cancelPending, queueNow } from "@/lib/emails/queue";
import { markRepliesRead } from "@/lib/emails/replies";
import { EMAIL_STEPS, type EmailStep } from "@/lib/emails/schedule";
import { processDueEmails, scheduleSequence } from "@/lib/emails/sender";
import { defaultEmailSettings } from "@/lib/emails/templates";
import { getBooking, recordLinkedIn, updateEmailSettings } from "@/lib/bookings/store";
import type { EmailSettings } from "@/lib/bookings/types";

// The dashboard is protected by proxy.ts (DASHBOARD_PASSWORD); server actions are posted to
// /dashboard routes, so they sit behind the same check.

// Booked-calls actions. Pipeline (lead) actions are in ./leads/actions.ts.

function assertStep(step: string): asserts step is EmailStep {
  if (!EMAIL_STEPS.includes(step as EmailStep)) throw new Error("Invalid email step");
}

/** Plans the sequence for a lead that doesn't have one yet (e.g. booked before emails existed). */
export async function scheduleEmails(bookingId: string) {
  const lead = await getBooking(bookingId);
  if (!lead) throw new Error("Lead not found");
  await scheduleSequence(lead);
  refresh();
}

export async function sendEmailNow(bookingId: string, step: string) {
  assertStep(step);
  await queueNow(bookingId, step, "Sent from dashboard");
  await processDueEmails();
  refresh();
}

export async function cancelEmail(bookingId: string, step: string) {
  assertStep(step);
  await cancelPending(bookingId, "Cancelled from dashboard", [step]);
  refresh();
}

const SETTING_KEYS = ["caseStudyId", "companyLine", "question", "team"] as const satisfies (keyof EmailSettings)[];

/** Saves the settings fields present in the form, keeping the lead's other settings. */
async function storeEmailSettings(bookingId: string, formData: FormData) {
  const lead = await getBooking(bookingId);
  if (!lead) throw new Error("Lead not found");
  const settings: EmailSettings = { ...lead.emailSettings };
  // Values equal to the defaults aren't stored, so later config changes still apply.
  const defaults = defaultEmailSettings();
  for (const key of SETTING_KEYS) {
    const v = formData.get(key);
    if (typeof v !== "string") continue;
    const value = v.trim();
    if (value && value !== defaults[key]) settings[key] = value;
    else delete settings[key];
  }
  await updateEmailSettings(bookingId, settings);
}

export async function saveEmailSettings(bookingId: string, formData: FormData) {
  await storeEmailSettings(bookingId, formData);
  refresh();
}

/** Saves Email 1's personalisation and sends it. */
export async function sendCaseStudy(bookingId: string, formData: FormData) {
  await storeEmailSettings(bookingId, formData);
  await queueNow(bookingId, "case_study", "Personalised and sent from dashboard");
  await processDueEmails();
  redirect(`/dashboard/calls/bookings/${encodeURIComponent(bookingId)}`);
}

export async function markReplyRead(id: string) {
  await markRepliesRead({ id });
  refresh();
}

export async function markLeadRepliesRead(bookingId: string) {
  await markRepliesRead({ bookingId });
  refresh();
}

export async function markAllRepliesRead() {
  await markRepliesRead();
  refresh();
}

export async function markLinkedInSent(bookingId: string) {
  await recordLinkedIn(bookingId, "linkedin_sent");
  refresh();
}

export async function skipLinkedIn(bookingId: string) {
  await recordLinkedIn(bookingId, "linkedin_skipped");
  refresh();
}

export type SyncState = { ok: boolean; message: string } | null;

/** Re-checks Cal.com for bookings, saving any the webhook missed and planning their emails. */
export async function syncFromCal(): Promise<SyncState> {
  try {
    const { saved, added } = await syncBookingsFromCal();
    // New leads get the sequence the webhook would have planned; past calls skip every step.
    for (const id of added) {
      const lead = await getBooking(id);
      if (lead) await scheduleSequence(lead);
    }
    if (added.length) await processDueEmails();
    refresh();
    const s = (n: number) => (n === 1 ? "" : "s");
    return {
      ok: true,
      message: `Checked ${saved} booking${s(saved)}, ${added.length ? `added ${added.length} new lead${s(added.length)}` : "nothing new"}.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Sync failed." };
  }
}
