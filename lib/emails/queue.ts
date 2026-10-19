import "server-only";

import type { Lead } from "@/lib/leads/types";
import { supabase } from "@/lib/supabase";
import type { EmailStep, PlannedEmail } from "./schedule";

/** Email queue in the `lead_emails` table (see supabase/migrations/003_email_sequence.sql). */

export type EmailStatus = "scheduled" | "sending" | "sent" | "skipped" | "cancelled" | "failed";

export interface LeadEmail {
  id: string;
  leadId: string;
  step: EmailStep;
  status: EmailStatus;
  dueAt: string | null;
  note: string | null;
  subject: string | null;
  resendId: string | null;
  attempts: number;
  sentAt: string | null;
}

interface Row {
  id: string;
  lead_id: string;
  step: EmailStep;
  status: EmailStatus;
  due_at: string | null;
  note: string | null;
  subject: string | null;
  resend_id: string | null;
  attempts: number;
  sent_at: string | null;
}

const MAX_ATTEMPTS = 3;

function fromRow(r: Row): LeadEmail {
  return {
    id: r.id,
    leadId: r.lead_id,
    step: r.step,
    status: r.status,
    dueAt: r.due_at,
    note: r.note,
    subject: r.subject,
    resendId: r.resend_id,
    attempts: r.attempts,
    sentAt: r.sent_at,
  };
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`Supabase: could not ${action}: ${error.message}`);
}

/** Sent or in-flight emails are never touched again. */
const isFinal = (status: EmailStatus) => status === "sent" || status === "sending";

export async function listLeadEmails(leadId: string): Promise<LeadEmail[]> {
  const { data, error } = await supabase().from("lead_emails").select("*").eq("lead_id", leadId);
  if (error) fail("load emails", error);
  return (data as Row[]).map(fromRow);
}

/**
 * Writes a plan for a lead, leaving emails that were already sent alone. Steps in `resend` that
 * already went out are sent again if the plan has a time for them (after a reschedule).
 */
export async function applyPlan(lead: Lead, plan: PlannedEmail[], resend: EmailStep[] = []): Promise<void> {
  const existing = await listLeadEmails(lead.id);
  const keep = (p: PlannedEmail) =>
    existing.some(
      (e) =>
        e.step === p.step &&
        (e.status === "sending" || (e.status === "sent" && !(p.dueAt && resend.includes(p.step)))),
    );
  const rows = plan
    .filter((p) => !keep(p))
    .map((p) => ({
      lead_id: lead.id,
      step: p.step,
      status: p.dueAt ? "scheduled" : "skipped",
      due_at: p.dueAt?.toISOString() ?? null,
      note: p.skipReason ?? null,
      attempts: 0,
    }));
  if (!rows.length) return;
  const { error } = await supabase().from("lead_emails").upsert(rows, { onConflict: "lead_id,step" });
  if (error) fail("schedule emails", error);
}

/** Queues one email to go out on the next run (used for the no-show nudge and "Send now"). */
export async function queueNow(leadId: string, step: EmailStep, note: string | null = null) {
  const existing = (await listLeadEmails(leadId)).find((e) => e.step === step);
  if (existing && isFinal(existing.status)) return false;
  const { error } = await supabase()
    .from("lead_emails")
    .upsert(
      { lead_id: leadId, step, status: "scheduled", due_at: new Date().toISOString(), note, attempts: 0 },
      { onConflict: "lead_id,step" },
    );
  if (error) fail("queue email", error);
  return true;
}

/** Cancels emails that haven't gone out yet. */
export async function cancelPending(leadId: string, reason: string, steps?: EmailStep[]) {
  let query = supabase()
    .from("lead_emails")
    .update({ status: "cancelled", note: reason })
    .eq("lead_id", leadId)
    .eq("status", "scheduled");
  if (steps) query = query.in("step", steps);
  const { error } = await query;
  if (error) fail("cancel emails", error);
}

/**
 * Picks up due emails and marks them "sending" so overlapping runs can't send the same email
 * twice. Also releases emails stuck in "sending" (e.g. a run that timed out); Resend's
 * idempotency key stops those from going out twice.
 */
export async function claimDueEmails(limit = 20): Promise<LeadEmail[]> {
  const db = supabase();
  const stuckBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await db.from("lead_emails").update({ status: "scheduled" }).eq("status", "sending").lt("updated_at", stuckBefore);

  const { data, error } = await db
    .from("lead_emails")
    .select("*")
    .eq("status", "scheduled")
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(limit);
  if (error) fail("load due emails", error);

  const claimed: LeadEmail[] = [];
  for (const row of data as Row[]) {
    const { data: got, error: claimError } = await db
      .from("lead_emails")
      .update({ status: "sending", attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("status", "scheduled")
      .select("*");
    if (claimError) fail("claim email", claimError);
    if (got?.length) claimed.push(fromRow(got[0] as Row));
  }
  return claimed;
}

async function update(id: string, changes: Partial<Row>) {
  const { error } = await supabase().from("lead_emails").update(changes).eq("id", id);
  if (error) fail("update email", error);
}

export const markSent = (id: string, resendId: string, subject: string) =>
  update(id, { status: "sent", resend_id: resendId, subject, sent_at: new Date().toISOString(), note: null });

export const markSkipped = (id: string, reason: string) => update(id, { status: "skipped", note: reason });

export const markCancelled = (id: string, reason: string) => update(id, { status: "cancelled", note: reason });

/** Retries with a growing delay, then gives up. */
export async function markFailed(email: LeadEmail, message: string) {
  if (email.attempts < MAX_ATTEMPTS) {
    const retryAt = new Date(Date.now() + email.attempts * 5 * 60_000).toISOString();
    await update(email.id, { status: "scheduled", due_at: retryAt, note: `Retrying: ${message}` });
  } else {
    await update(email.id, { status: "failed", note: message });
  }
}

/** Waits without spending an attempt (e.g. emails switched off or config incomplete). */
export const markWaiting = (email: LeadEmail, reason: string) =>
  update(email.id, {
    status: "scheduled",
    attempts: email.attempts - 1,
    due_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    note: reason,
  });
