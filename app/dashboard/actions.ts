"use server";

import { refresh } from "next/cache";
import { importBookingsFromCal } from "@/lib/cal/api";
import { cancelPending, queueNow } from "@/lib/emails/queue";
import { EMAIL_STEPS, type EmailStep } from "@/lib/emails/schedule";
import { processDueEmails, scheduleSequence } from "@/lib/emails/sender";
import { defaultEmailSettings } from "@/lib/emails/templates";
import { getLead, updateEmailSettings, updateLeadTracking } from "@/lib/leads/store";
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

export async function saveEmailSettings(leadId: string, formData: FormData) {
  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const settings: EmailSettings = {
    caseStudyId: text("caseStudyId"),
    companyLine: text("companyLine"),
    question: text("question"),
    team: text("team"),
  };
  // Values equal to the defaults aren't stored, so later config changes still apply.
  const defaults = defaultEmailSettings();
  for (const key of Object.keys(settings) as (keyof EmailSettings)[]) {
    if (settings[key] === defaults[key]) delete settings[key];
  }
  await updateEmailSettings(leadId, JSON.parse(JSON.stringify(settings)));
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
