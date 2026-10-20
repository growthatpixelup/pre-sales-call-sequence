"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { importBookingsFromCal } from "@/lib/cal/api";
import { cancelPending, queueNow } from "@/lib/emails/queue";
import { markRepliesRead } from "@/lib/emails/replies";
import { EMAIL_STEPS, type EmailStep } from "@/lib/emails/schedule";
import { processDueEmails, scheduleSequence } from "@/lib/emails/sender";
import { defaultEmailSettings } from "@/lib/emails/templates";
import { getLead, recordLinkedIn, updateEmailSettings, updateLeadTracking } from "@/lib/leads/store";
import { LEAD_STAGES, type EmailSettings, type LeadStage } from "@/lib/leads/types";

// The dashboard is protected by proxy.ts (DASHBOARD_PASSWORD); server actions are posted to
// /dashboard routes, so they sit behind the same check.

export async function updateStage(id: string, formData: FormData) {
  const stage = formData.get("stage");
  if (typeof stage !== "string" || !LEAD_STAGES.includes(stage as LeadStage)) {
    throw new Error("Invalid stage");
  }
  await updateLeadTracking(id, { stage: stage as LeadStage });
  refresh();
}

export async function saveInternalNotes(id: string, formData: FormData) {
  const notes = formData.get("internalNotes");
  await updateLeadTracking(id, { internalNotes: typeof notes === "string" ? notes : "" });
  refresh();
}

function assertStep(step: string): asserts step is EmailStep {
  if (!EMAIL_STEPS.includes(step as EmailStep)) throw new Error("Invalid email step");
}

/** Plans the sequence for a lead that doesn't have one yet (e.g. booked before emails existed). */
export async function scheduleEmails(leadId: string) {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead not found");
  await scheduleSequence(lead);
  refresh();
}

export async function sendEmailNow(leadId: string, step: string) {
  assertStep(step);
  await queueNow(leadId, step, "Sent from dashboard");
  await processDueEmails();
  refresh();
}

export async function cancelEmail(leadId: string, step: string) {
  assertStep(step);
  await cancelPending(leadId, "Cancelled from dashboard", [step]);
  refresh();
}

const SETTING_KEYS = ["caseStudyId", "companyLine", "question", "team"] as const satisfies (keyof EmailSettings)[];

/** Saves the settings fields present in the form, keeping the lead's other settings. */
async function storeEmailSettings(leadId: string, formData: FormData) {
  const lead = await getLead(leadId);
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
  await updateEmailSettings(leadId, settings);
}

export async function saveEmailSettings(leadId: string, formData: FormData) {
  await storeEmailSettings(leadId, formData);
  refresh();
}

/** Saves Email 1's personalisation and sends it. */
export async function sendCaseStudy(leadId: string, formData: FormData) {
  await storeEmailSettings(leadId, formData);
  await queueNow(leadId, "case_study", "Personalised and sent from dashboard");
  await processDueEmails();
  redirect(`/dashboard/leads/${encodeURIComponent(leadId)}`);
}

export async function saveDealValue(leadId: string, formData: FormData) {
  const raw = String(formData.get("dealValue") ?? "").replace(/[$,\s]/g, "");
  const value = raw ? Number(raw) : null;
  if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error("Invalid deal value");
  await updateLeadTracking(leadId, { dealValue: value });
  refresh();
}

export async function markReplyRead(id: string) {
  await markRepliesRead({ id });
  refresh();
}

export async function markLeadRepliesRead(leadId: string) {
  await markRepliesRead({ leadId });
  refresh();
}

export async function markAllRepliesRead() {
  await markRepliesRead();
  refresh();
}

export async function markLinkedInSent(leadId: string) {
  await recordLinkedIn(leadId, "linkedin_sent");
  refresh();
}

export async function skipLinkedIn(leadId: string) {
  await recordLinkedIn(leadId, "linkedin_skipped");
  refresh();
}

export type ImportState = { ok: boolean; message: string } | null;

export async function importFromCal(): Promise<ImportState> {
  try {
    const count = await importBookingsFromCal();
    refresh();
    return { ok: true, message: `Imported ${count} booking${count === 1 ? "" : "s"} from Cal.com.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Import failed." };
  }
}
