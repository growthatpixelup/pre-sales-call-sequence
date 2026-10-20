import Link from "next/link";
import { listLeadEmails } from "@/lib/emails/queue";
import { EMAIL_STEPS, STEP_LABELS } from "@/lib/emails/schedule";
import { emailSetupProblems } from "@/lib/emails/sender";
import { defaultEmailSettings, linkedInMessage } from "@/lib/emails/templates";
import { callStatus, formatDateTime } from "@/lib/format";
import type { Lead } from "@/lib/leads/types";
import { cancelEmail, saveEmailSettings, scheduleEmails, sendEmailNow } from "../actions";
import { EmailStatusBadge } from "./badges";
import { CopyButton } from "./copy-button";

const BUTTON =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
const PRIMARY_BUTTON =
  "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const INPUT =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export async function LeadEmails({ lead }: { lead: Lead }) {
  const emails = await listLeadEmails(lead.id);
  const problems = emailSetupProblems();
  const testTo = process.env.EMAIL_TEST_TO;
  const upcoming = callStatus(lead) === "upcoming";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Emails</h2>
        {upcoming && emails.length === 0 && (
          <form action={scheduleEmails.bind(null, lead.id)}>
            <button type="submit" className={BUTTON}>
              Schedule email sequence
            </button>
          </form>
        )}
      </div>

      {problems.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Emails are paused until this is set up. Scheduled emails will wait.</p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {testTo && (
        <p className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Test mode: every email goes to {testTo}, not the lead.
        </p>
      )}

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {EMAIL_STEPS.map((step) => {
          const email = emails.find((e) => e.step === step);
          const status = email?.status ?? null;
          const when =
            status === "sent" && email?.sentAt
              ? `Sent ${formatDateTime(email.sentAt)}`
              : status === "scheduled" && email?.dueAt
                ? `Due ${formatDateTime(email.dueAt)}`
                : status === "draft"
                  ? `Personalise it, then send it yourself${email?.dueAt ? `. Best sent around ${formatDateTime(email.dueAt)}` : ""}.`
                  : step === "no_show" && !email
                    ? "Sends if they haven't joined 5 minutes in"
                    : step === "how_we_work" && !email
                      ? "Goes out at 9 AM (their time) the morning after Email 1 is sent"
                      : null;
          // Email 1 is always sent by hand, from its own page.
          const manual = step === "case_study";
          return (
            <li key={step} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{STEP_LABELS[step]}</span>
                  <EmailStatusBadge status={status} />
                </div>
                {when && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{when}</p>}
                {email?.note && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{email.note}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                {manual && upcoming && status !== "sent" && status !== "sending" ? (
                  <Link href={`/dashboard/leads/${lead.id}/emails/${step}`} className={PRIMARY_BUTTON}>
                    Personalise &amp; send
                  </Link>
                ) : (
                  <Link href={`/dashboard/leads/${lead.id}/emails/${step}`} className={BUTTON}>
                    Preview
                  </Link>
                )}
                {!manual && status !== "sent" && status !== "sending" && (
                  <form action={sendEmailNow.bind(null, lead.id, step)}>
                    <button type="submit" className={BUTTON}>
                      Send now
                    </button>
                  </form>
                )}
                {(status === "scheduled" || status === "draft") && (
                  <form action={cancelEmail.bind(null, lead.id, step)}>
                    <button type="submit" className={BUTTON}>
                      {status === "draft" ? "Don't send" : "Cancel"}
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function EmailPersonalisation({ lead }: { lead: Lead }) {
  const defaults = defaultEmailSettings();
  const settings = { ...defaults, ...lead.emailSettings };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-800">
        Email personalisation
      </h2>
      <form action={saveEmailSettings.bind(null, lead.id)} className="space-y-4 p-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Email 1 (case study) is personalised on its own page: use “Personalise &amp; send” in the Emails list.
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Who&apos;s joining (Email 3)</span>
          <input name="team" defaultValue={settings.team} className={INPUT} />
        </label>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Save personalisation
        </button>
      </form>
    </section>
  );
}

export function LinkedInNote({ lead }: { lead: Lead }) {
  const message = linkedInMessage(lead);
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">LinkedIn connect note</h2>
        <CopyButton text={message} />
      </div>
      <p className="p-4 text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
    </section>
  );
}
