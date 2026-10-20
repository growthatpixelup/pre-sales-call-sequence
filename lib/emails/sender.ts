import "server-only";

import { Resend } from "resend";
import { nextTwoSlots } from "@/lib/cal/slots";
import { addLeadEvent, getLead } from "@/lib/leads/store";
import type { Lead } from "@/lib/leads/types";
import { missingEmailConfig } from "./config";
import {
  applyPlan,
  cancelPending,
  claimDueEmails,
  expireDrafts,
  listLeadEmails,
  markCancelled,
  markFailed,
  markSent,
  markSkipped,
  markWaiting,
  queueNow,
  type LeadEmail,
} from "./queue";
import { PRE_CALL_STEPS, STEP_LABELS, planHowWeWork, planSequence } from "./schedule";
import { renderEmail, type EmailContext } from "./templates";

let resend: Resend | null = null;

/** Why emails can't send right now. Empty means ready. */
export function emailSetupProblems(): string[] {
  const problems: string[] = [];
  if (!process.env.RESEND_API_KEY) problems.push("RESEND_API_KEY is not set");
  if (!process.env.EMAIL_FROM) problems.push("EMAIL_FROM is not set");
  // In test mode (EMAIL_TEST_TO) placeholders are allowed: every email goes to you, never a lead.
  const missing = missingEmailConfig();
  if (missing.length && !process.env.EMAIL_TEST_TO) {
    problems.push(`Fill in lib/emails/config.ts: ${missing.join(", ")}`);
  }
  return problems;
}

/**
 * Plans a lead's sequence. After a reschedule it's rebuilt from the new call time: the
 * confirmation and call-day emails go out again, Email 1 and Email 2 never do.
 */
export async function scheduleSequence(lead: Lead, { rescheduled = false } = {}) {
  if (lead.bookingStatus !== "accepted") return;
  const sentEmails = (await listLeadEmails(lead.id)).filter((e) => e.status === "sent");
  const sent = new Set(sentEmails.map((e) => e.step));
  const caseStudySentAt = sentEmails.find((e) => e.step === "case_study")?.sentAt;
  const resend = rescheduled ? PRE_CALL_STEPS.filter((s) => s !== "case_study" && s !== "how_we_work") : [];
  for (const step of resend) sent.delete(step);
  const plan = planSequence(lead, new Date(), sent, caseStudySentAt ? new Date(caseStudySentAt) : null);
  await applyPlan(lead, plan, resend);
}

export async function cancelSequence(leadId: string, reason: string) {
  await cancelPending(leadId, reason);
}

/** Queues the no-show nudge to go out on the next run. */
export async function queueNoShowNudge(leadId: string, note: string) {
  const queued = await queueNow(leadId, "no_show", note);
  if (queued) await addLeadEvent(leadId, "no_show_nudge_queued", note);
}

export async function emailContext(lead: Lead, email: Pick<LeadEmail, "step">): Promise<EmailContext> {
  const ctx: EmailContext = { sendAt: new Date() };
  if (email.step === "no_show" && lead.eventTypeId) {
    ctx.slots = await nextTwoSlots(lead.eventTypeId, lead.timeZone);
  }
  return ctx;
}

async function sendOne(email: LeadEmail, problems: string[]) {
  const lead = await getLead(email.leadId);
  if (!lead) return markCancelled(email.id, "Lead no longer exists");
  if (lead.bookingStatus === "cancelled" || lead.bookingStatus === "rejected") {
    return markCancelled(email.id, "Booking was cancelled");
  }

  const now = Date.now();
  if (PRE_CALL_STEPS.includes(email.step) && now >= Date.parse(lead.startTime)) {
    return markSkipped(email.id, "Call had already started");
  }
  if (email.step === "no_show" && now >= Date.parse(lead.endTime)) {
    return markSkipped(email.id, "Call had already ended");
  }
  if (!lead.email) return markSkipped(email.id, "Lead has no email address");
  if (email.step === "how_we_work") {
    const caseStudy = (await listLeadEmails(lead.id)).find((e) => e.step === "case_study");
    if (caseStudy?.status !== "sent") return markSkipped(email.id, "Email 1 wasn't sent");
  }
  if (problems.length) return markWaiting(email, `Waiting: ${problems[0]}`);

  const rendered = renderEmail(email.step, lead, await emailContext(lead, email));
  resend ??= new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send(
    {
      from: process.env.EMAIL_FROM!,
      // EMAIL_TEST_TO sends everything to you instead of the lead while testing.
      to: process.env.EMAIL_TEST_TO || lead.email,
      replyTo: process.env.EMAIL_REPLY_TO || undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: "step", value: email.step }],
    },
    // Includes the call time so a confirmation resent after a reschedule isn't deduplicated.
    { idempotencyKey: `lead-email-${email.id}-${lead.startTime}` },
  );

  if (error || !data) return markFailed(email, error?.message ?? "Unknown Resend error");
  await markSent(email.id, data.id, rendered.subject);
  await addLeadEvent(lead.id, "email_sent", STEP_LABELS[email.step]);
  // Email 2 follows the morning after Email 1, which is sent by hand.
  if (email.step === "case_study") await applyPlan(lead, [planHowWeWork(lead, new Date())]);
}

/** Sends every email that's due. Called every minute by the scheduler. */
export async function processDueEmails() {
  await expireDrafts();
  const problems = emailSetupProblems();
  const due = await claimDueEmails();
  const results = { processed: due.length, errors: 0 };
  for (const email of due) {
    try {
      await sendOne(email, problems);
    } catch (err) {
      results.errors++;
      await markFailed(email, err instanceof Error ? err.message : String(err)).catch(() => {});
    }
  }
  return { ...results, waitingOn: problems };
}
