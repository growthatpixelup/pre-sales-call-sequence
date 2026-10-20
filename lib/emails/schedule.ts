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

/** A `draft` waits for someone to send it from the dashboard; its `dueAt` is only a suggestion. */
export type PlannedEmail =
  | { step: EmailStep; dueAt: Date; skipReason?: undefined; draft?: boolean }
  | { step: EmailStep; dueAt: null; skipReason: string; draft?: undefined };

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
 * differ when re-planning after a reschedule). `alreadySent` lists steps that went out before,
 * and `caseStudySentAt` is when Email 1 went out, if it did.
 */
export function planSequence(
  lead: Lead,
  now = new Date(),
  alreadySent = new Set<EmailStep>(),
  caseStudySentAt: Date | null = null,
): PlannedEmail[] {
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

  // Booking confirmation: 15 minutes after booking. If the call is close, send it straight away.
  let confirmationAt = new Date(bookedAt.getTime() + 15 * MINUTE);
  if (confirmationAt.getTime() >= start.getTime() - HOUR) confirmationAt = bookedAt;
  if (confirmationAt < now) confirmationAt = now;
  at("confirmation", confirmationAt);

  // Email 3: 8 AM on the call day, or 6 PM the day before if the call is before noon. Skipped
  // if that time has already passed. Worked out first because Email 1 must land before it.
  const morningCall = localHour(start, tz) < 12;
  const expectAt = morningCall
    ? atLocalTime(addDays(callDay, -1), emailConfig.whatToExpectEveningHour, tz)
    : atLocalTime(callDay, emailConfig.whatToExpectMorningHour, tz);
  const expectSkip =
    expectAt < now
      ? `${morningCall ? "6:00 PM the day before" : "8:00 AM on the call day"} had passed`
      : expectAt <= confirmationAt
        ? "Would go out before the booking confirmation"
        : null;

  // Email 1 is personalised and sent by hand from the dashboard, so it's planned as a draft. The
  // suggested time is 24 hours after booking, moved out of quiet hours, and before Email 3.
  // Skipped if the call is the next day (or sooner).
  if (alreadySent.has("case_study")) {
    // Already went out; nothing to plan.
  } else if (callDay <= addDays(localDate(bookedAt, tz), 1)) {
    skip("case_study", "Call is the day after booking or sooner");
  } else {
    let suggestedAt = outOfQuietHours(new Date(bookedAt.getTime() + DAY), tz);
    if (!expectSkip && suggestedAt >= expectAt) suggestedAt = new Date(expectAt.getTime() - HOUR);
    if (suggestedAt < now) suggestedAt = now;
    plan.push({ step: "case_study", dueAt: suggestedAt, draft: true });
  }

  // Email 2 is planned once Email 1 has gone out (see planHowWeWork). Until then it has no row.
  if (caseStudySentAt) plan.push(planHowWeWork(lead, caseStudySentAt, now));
  else if (plan.some((p) => p.step === "case_study" && !p.draft)) skip("how_we_work", "Email 1 isn't going out");

  if (expectSkip) skip("what_to_expect", expectSkip);
  else at("what_to_expect", expectAt);

  // Reminder: 1 hour before.
  const reminderAt = new Date(start.getTime() - HOUR);
  if (reminderAt < now) skip("reminder_1h", "Booked less than an hour before the call");
  else if (reminderAt.getTime() - confirmationAt.getTime() < 30 * MINUTE) {
    skip("reminder_1h", "Confirmation (with the call link) goes out just before");
  } else at("reminder_1h", reminderAt);

  return plan;
}

/** Email 2: 9 AM (their time) the day after Email 1 went out. Skipped if the call is that day or sooner. */
export function planHowWeWork(lead: Lead, caseStudySentAt: Date, now = new Date()): PlannedEmail {
  const tz = safeTimeZone(lead.timeZone);
  const callDay = localDate(new Date(lead.startTime), tz);
  const day = addDays(localDate(caseStudySentAt, tz), 1);
  const dueAt = atLocalTime(day, emailConfig.howWeWorkHour, tz);
  if (callDay <= day) return { step: "how_we_work", dueAt: null, skipReason: "Call is on or before the morning after Email 1" };
  if (dueAt < now) return { step: "how_we_work", dueAt: null, skipReason: "Send time has passed" };
  return { step: "how_we_work", dueAt };
}

/** Moves a send inside quiet hours (9 PM to 8 AM local) to the next 8 AM. */
function outOfQuietHours(date: Date, tz: string): Date {
  const { start, end } = emailConfig.quietHours;
  const hour = localHour(date, tz);
  if (hour >= end && hour < start) return date;
  const day = hour >= start ? addDays(localDate(date, tz), 1) : localDate(date, tz);
  return atLocalTime(day, end, tz);
}

/** Whether Email 3 is going out the day before the call (changes "today" to "tomorrow"). */
export function isDayBefore(sendAt: Date, lead: Lead): boolean {
  const tz = safeTimeZone(lead.timeZone);
  return localDate(sendAt, tz) < localDate(new Date(lead.startTime), tz);
}
