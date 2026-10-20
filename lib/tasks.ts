import "server-only";

import { leadsWithoutEmails, listEmailActivity, type LeadEmail } from "@/lib/emails/queue";
import { linkedInOutcomes, listLeads } from "@/lib/leads/store";
import type { Lead } from "@/lib/leads/types";

/** Scheduled emails this late mean the cron isn't running. */
const OVERDUE_MS = 15 * 60_000;
/** Tasks for calls this close are flagged urgent. */
const URGENT_MS = 24 * 60 * 60_000;

export type TaskKind = "email" | "linkedin" | "failed" | "overdue" | "unscheduled";

export interface Task {
  key: string;
  kind: TaskKind;
  lead: Lead;
  /** The email the task is about, for email tasks. */
  email?: LeadEmail;
  /** Call within a day, or the suggested send time has passed. */
  urgent: boolean;
}

/**
 * Everything that needs a person before upcoming calls: Email 1 drafts to personalise, LinkedIn
 * notes to send, and emails that failed, are overdue or were never planned. Soonest call first.
 */
export async function loadTasks(activitySince: Date) {
  const now = Date.now();
  const [leads, activity, linkedIn] = await Promise.all([
    listLeads(),
    listEmailActivity(activitySince),
    linkedInOutcomes(),
  ]);
  const byId = new Map(leads.map((l) => [l.id, l]));
  const emails = activity.filter((e) => byId.has(e.leadId));
  const upcoming = leads.filter((l) => l.bookingStatus === "accepted" && Date.parse(l.startTime) > now);
  const unscheduled = await leadsWithoutEmails(upcoming.map((l) => l.id));

  const soon = (lead: Lead) => Date.parse(lead.startTime) - now < URGENT_MS;
  const emailTask = (kind: TaskKind, email: LeadEmail, urgent = false): Task => {
    const lead = byId.get(email.leadId)!;
    return { key: `${kind}-${email.id}`, kind, lead, email, urgent: urgent || soon(lead) };
  };
  const isUpcoming = (e: LeadEmail) => upcoming.some((l) => l.id === e.leadId);

  const tasks: Task[] = [
    ...emails
      .filter((e) => e.status === "draft" && isUpcoming(e))
      .map((e) => emailTask("email", e, Boolean(e.dueAt && Date.parse(e.dueAt) <= now))),
    ...upcoming
      .filter((l) => !linkedIn.has(l.id))
      .map((lead): Task => ({ key: `linkedin-${lead.id}`, kind: "linkedin", lead, urgent: soon(lead) })),
    ...emails.filter((e) => e.status === "failed").map((e) => emailTask("failed", e, true)),
    ...emails
      .filter((e) => e.status === "scheduled" && e.dueAt && Date.parse(e.dueAt) <= now - OVERDUE_MS)
      .map((e) => emailTask("overdue", e, true)),
    ...upcoming
      .filter((l) => unscheduled.has(l.id))
      .map((lead): Task => ({ key: `unscheduled-${lead.id}`, kind: "unscheduled", lead, urgent: soon(lead) })),
  ].sort((a, b) => Date.parse(a.lead.startTime) - Date.parse(b.lead.startTime));

  return { tasks, leads, emails, upcoming, linkedIn };
}
