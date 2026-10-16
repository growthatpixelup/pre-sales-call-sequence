import type { Lead } from "@/lib/leads/types";
import { emailConfig } from "./config";
import { DAY, HOUR, MINUTE, addDays, atLocalTime, localDate, localHour, safeTimeZone } from "./time";

/** Emails in the sequence, in send order. `no_show` is only sent when Cal.com reports a no-show. */
export const EMAIL_STEPS = [
  "confirmation",
  "case_study",
  "how_we_work",
  "what_to_expect",
  "reminder_1h",
  "no_show",
] as const;
export type EmailStep = (typeof EMAIL_STEPS)[number];

export const STEP_LABELS: Record<EmailStep, string> = {
  confirmation: "Booking confirmation",
  case_study: "Email 1: Case study + proof",
  how_we_work: "Email 2: How we work",
  what_to_expect: "Email 3: What to expect",
  reminder_1h: "Reminder: 1 hour before",
  no_show: "Reminder: no-show nudge",
};

export type PlannedEmail =
  | { step: EmailStep; dueAt: Date; skipReason?: undefined }
  | { step: EmailStep; dueAt: null; skipReason: string };

/** Steps that only make sense before the call starts. */
export const PRE_CALL_STEPS: EmailStep[] = [
  "confirmation",
  "case_study",
  "how_we_work",
  "what_to_expect",
  "reminder_1h",
];

/**
 * Works out when each email should go, following the sequence doc. Times are in the guest's
 * time zone. `bookedAt` is when the booking first arrived; `now` is when we're planning (they
 * differ when re-planning after a reschedule).
 */
export function planSequence(lead: Lead, now = new Date()): PlannedEmail[] {
  const tz = safeTimeZone(lead.timeZone);
  const start = new Date(lead.startTime);
  const bookedAt = new Date(lead.createdAt);
  const callDay = localDate(start, tz);
  const plan: PlannedEmail[] = [];
  const skip = (step: EmailStep, skipReason: string) => plan.push({ step, dueAt: null, skipReason });
  const at = (step: EmailStep, dueAt: Date) => plan.push({ step, dueAt });

  if (start <= now) {
    for (const step of PRE_CALL_STEPS) skip(step, "Call has already started");
    return plan;
  }

  // Booking confirmation: 30 minutes after booking. If the call is close, send it straight away.
  let confirmationAt = new Date(bookedAt.getTime() + 30 * MINUTE);
  if (confirmationAt.getTime() >= start.getTime() - HOUR) confirmationAt = bookedAt;
  if (confirmationAt < now) confirmationAt = now;
  at("confirmation", confirmationAt);

  // Email 1: 24 hours after booking. Skip if the call is the next day (or sooner).
  const caseStudyAt = new Date(bookedAt.getTime() + DAY);
  if (callDay <= addDays(localDate(bookedAt, tz), 1)) {
    skip("case_study", "Call is the day after booking or sooner");
  } else if (caseStudyAt < now) {
    skip("case_study", "Send time has passed");
  } else {
    at("case_study", caseStudyAt);
  }

  // Email 2: the morning after Email 1. Skip if the call is that day (Email 3 links it instead).
  const howWeWorkDay = addDays(localDate(caseStudyAt, tz), 1);
  const howWeWorkAt = atLocalTime(howWeWorkDay, emailConfig.morningHour, tz);
  if (callDay <= howWeWorkDay) {
    skip("how_we_work", "Call is on or before the morning after Email 1");
  } else if (howWeWorkAt < now) {
    skip("how_we_work", "Send time has passed");
  } else {
    at("how_we_work", howWeWorkAt);
  }

  // Email 3: morning of the call, or the evening before if the call is before noon.
  const morningCall = localHour(start, tz) < 12;
  let expectAt = morningCall
    ? atLocalTime(addDays(callDay, -1), emailConfig.eveningHour, tz)
    : atLocalTime(callDay, emailConfig.morningHour, tz);
  // Booked after that time: still send, as long as it lands well before the call and a while
  // after the confirmation.
  const earliest = new Date(Math.max(now.getTime(), confirmationAt.getTime() + HOUR));
  if (expectAt < earliest) expectAt = earliest;
  if (expectAt.getTime() > start.getTime() - 75 * MINUTE) {
    skip("what_to_expect", "Booked too close to the call");
  } else {
    at("what_to_expect", expectAt);
  }

  // Reminder: 1 hour before.
  const reminderAt = new Date(start.getTime() - HOUR);
  if (reminderAt < now) skip("reminder_1h", "Booked less than an hour before the call");
  else if (reminderAt.getTime() - confirmationAt.getTime() < 30 * MINUTE) {
    skip("reminder_1h", "Confirmation (with the call link) goes out just before");
  } else at("reminder_1h", reminderAt);

  return plan;
}

/** Whether Email 3 is going out the day before the call (changes "today" to "tomorrow"). */
export function isDayBefore(sendAt: Date, lead: Lead): boolean {
  const tz = safeTimeZone(lead.timeZone);
  return localDate(sendAt, tz) < localDate(new Date(lead.startTime), tz);
}
