import Link from "next/link";
import { listLeadEmails } from "@/lib/emails/queue";
import { EMAIL_STEPS, STEP_LABELS } from "@/lib/emails/schedule";
import { emailSetupProblems } from "@/lib/emails/sender";
import { defaultEmailSettings, linkedInMessage } from "@/lib/emails/templates";
import { callStatus, formatDateTime } from "@/lib/format";
import type { Lead } from "@/lib/leads/types";
import { cancelEmail, markLinkedInSent, saveEmailSettings, scheduleEmails, sendEmailNow } from "../actions";
import { EmailStatusBadge } from "./badges";
import { CopyButton } from "./copy-button";
import { Callout, Section, Tag } from "./ui";

export async function LeadEmails({ lead }: { lead: Lead }) {
  const emails = await listLeadEmails(lead.id);
  const problems = emailSetupProblems();
  const testTo = process.env.EMAIL_TEST_TO;
  const upcoming = callStatus(lead) === "upcoming";

  return (
    <Section
      label="Emails"
      aside={
        upcoming &&
        emails.length === 0 && (
          <form action={scheduleEmails.bind(null, lead.id)}>
            <button type="submit" className="action">
              Schedule sequence
            </button>
          </form>
        )
      }
    >
      {(problems.length > 0 || testTo) && (
        <div className="mb-6 grid gap-px">
          {problems.length > 0 && (
            <Callout title="Emails are paused.">
              Scheduled emails will wait until this is set up.
              <ul className="bullets mt-2">
                {problems.map((p) => (
                  <li key={p} className="break-words">
                    {p}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {testTo && <Callout title="Test mode.">Every email goes to {testTo}, not the lead.</Callout>}
        </div>
      )}

      <ul className="list">
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
            <li key={step} className={status === "draft" ? "item-picked" : undefined}>
              <div className="item">
                <div className="min-w-0">
                  <p className="item-title m-0">{STEP_LABELS[step]}</p>
                  <div className="mt-3">
                    <EmailStatusBadge status={status} />
                  </div>
                  {when && <p className="m-0 mt-3 text-[0.9rem] text-muted">{when}</p>}
                  {email?.note && <p className="m-0 mt-1 text-[0.9rem] text-muted">{email.note}</p>}
                </div>
                <div className="item-actions">
                  {manual && upcoming && status !== "sent" && status !== "sending" ? (
                    <Link href={`/dashboard/leads/${lead.id}/emails/${step}`} className="action">
                      Personalise &amp; send
                    </Link>
                  ) : (
                    <Link href={`/dashboard/leads/${lead.id}/emails/${step}`} className="action">
                      Preview
                    </Link>
                  )}
                  {!manual && status !== "sent" && status !== "sending" && (
                    <form action={sendEmailNow.bind(null, lead.id, step)}>
                      <button type="submit" className="action">
                        Send now
                      </button>
                    </form>
                  )}
                  {(status === "scheduled" || status === "draft") && (
                    <form action={cancelEmail.bind(null, lead.id, step)}>
                      <button type="submit" className="action">
                        {status === "draft" ? "Don't send" : "Cancel"}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function EmailPersonalisation({ lead }: { lead: Lead }) {
  const defaults = defaultEmailSettings();
  const settings = { ...defaults, ...lead.emailSettings };

  return (
    <Section label="Email personalisation">
      <form action={saveEmailSettings.bind(null, lead.id)} className="grid max-w-[68ch] gap-5">
        <p className="hint m-0">
          Email 1 (case study) is personalised on its own page: use “Personalise &amp; send” in the Emails list.
        </p>
        <label className="field">
          <span className="mono-label">Who&apos;s joining (Email 3)</span>
          <input name="team" defaultValue={settings.team} className="input" />
        </label>
        <button type="submit" className="btn">
          Save personalisation
        </button>
      </form>
    </Section>
  );
}

export function LinkedInNote({ lead }: { lead: Lead }) {
  const message = linkedInMessage(lead);
  const outcome = [...lead.events].reverse().find((e) => e.type === "linkedin_sent" || e.type === "linkedin_skipped");
  return (
    <Section
      label="LinkedIn connect note"
      aside={
        outcome ? (
          <Tag tone="neutral">{outcome.type === "linkedin_sent" ? "Sent" : "Skipped"}</Tag>
        ) : (
          <div className="flex flex-wrap gap-2">
            <CopyButton text={message} />
            <form action={markLinkedInSent.bind(null, lead.id)}>
              <button type="submit" className="action">
                Mark sent
              </button>
            </form>
          </div>
        )
      }
    >
      <p className="preview m-0 max-w-[68ch]">{message}</p>
    </Section>
  );
}
