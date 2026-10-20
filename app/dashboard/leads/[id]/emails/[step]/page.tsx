import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listLeadEmails, type LeadEmail } from "@/lib/emails/queue";
import { EMAIL_STEPS, STEP_LABELS, type EmailStep } from "@/lib/emails/schedule";
import { emailContext, emailSetupProblems } from "@/lib/emails/sender";
import { defaultEmailSettings, renderEmail } from "@/lib/emails/templates";
import { callStatus, formatDateTime } from "@/lib/format";
import { getLead } from "@/lib/leads/store";
import type { Lead } from "@/lib/leads/types";
import { saveEmailSettings, sendCaseStudy } from "../../../../actions";
import { CaseStudyComposer } from "../../../../_components/case-study-composer";

export const metadata: Metadata = { title: "Email preview · Dashboard" };

export default function EmailPreviewPage({ params }: PageProps<"/dashboard/leads/[id]/emails/[step]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: Promise<{ id: string; step: string }> }) {
  const { id, step } = await params;
  if (!EMAIL_STEPS.includes(step as EmailStep)) notFound();
  const leadId = decodeURIComponent(id);
  const [lead, emails] = await Promise.all([getLead(leadId), listLeadEmails(leadId)]);
  if (!lead) notFound();

  const email = emails.find((e) => e.step === step);
  if (
    step === "case_study" &&
    email?.status !== "sent" &&
    email?.status !== "sending" &&
    callStatus(lead) === "upcoming"
  ) {
    return <ComposeCaseStudy lead={lead} emails={emails} />;
  }

  const ctx = await emailContext(lead, { step: step as EmailStep });
  // Preview as it will look when it sends (matters for Email 3's "today" vs "tomorrow").
  if (email?.status === "scheduled" && email.dueAt) ctx.sendAt = new Date(email.dueAt);
  const rendered = renderEmail(step as EmailStep, lead, ctx);

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/leads/${lead.id}`}
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← {lead.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{STEP_LABELS[step as EmailStep]}</h1>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <dl className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          <div className="flex gap-3 px-4 py-2">
            <dt className="w-16 text-zinc-500 dark:text-zinc-400">From</dt>
            <dd>{process.env.EMAIL_FROM ?? "EMAIL_FROM not set"}</dd>
          </div>
          <div className="flex gap-3 px-4 py-2">
            <dt className="w-16 text-zinc-500 dark:text-zinc-400">To</dt>
            <dd>{process.env.EMAIL_TEST_TO ? `${process.env.EMAIL_TEST_TO} (test mode)` : lead.email}</dd>
          </div>
          <div className="flex gap-3 px-4 py-2">
            <dt className="w-16 text-zinc-500 dark:text-zinc-400">Subject</dt>
            <dd className="font-medium">{rendered.subject}</dd>
          </div>
        </dl>
        {/* Emails render on white like most mail apps. */}
        <iframe
          title="Email preview"
          srcDoc={rendered.html}
          sandbox=""
          className="h-[560px] w-full border-t border-zinc-200 bg-white dark:border-zinc-800"
        />
      </div>
    </div>
  );
}

/** Email 1 is personalised and sent by hand: the form answers to work from, the form, and a live preview. */
function ComposeCaseStudy({ lead, emails }: { lead: Lead; emails: LeadEmail[] }) {
  const email = emails.find((e) => e.step === "case_study");
  const expect = emails.find((e) => e.step === "what_to_expect");
  const problems = emailSetupProblems();
  const testTo = process.env.EMAIL_TEST_TO;
  const defaults = defaultEmailSettings();
  const initial = {
    caseStudyId: lead.emailSettings.caseStudyId ?? defaults.caseStudyId,
    companyLine: lead.emailSettings.companyLine ?? defaults.companyLine,
    question: lead.emailSettings.question ?? defaults.question,
  };
  const facts: [string, string | null][] = [
    ["Business", lead.businessName],
    ["Website", lead.businessWebsite],
    ["Problem to solve", lead.problem ?? lead.legacy.topic],
    ["Why they booked", lead.bookingReason],
    ["Capital raised", lead.capitalRaised],
    ["Investment range", lead.investmentRange ?? lead.legacy.budget],
    ["How they found us", lead.referralSource],
  ];

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/leads/${lead.id}`}
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← {lead.name}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{STEP_LABELS.case_study}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick the case study, write the company line and closing question, check the preview, then send. Call is {formatDateTime(lead.startTime)}.
          {email?.status === "draft" && email.dueAt && <> Best sent around {formatDateTime(email.dueAt)}.</>}
        </p>
      </div>

      {problems.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Emails are paused until this is set up: {problems.join("; ")}. Sending will queue it until then.
        </p>
      )}
      {email?.status === "skipped" && email.note && (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          The sequence skipped this email ({email.note.toLowerCase()}). You can still send it.
        </p>
      )}
      {expect?.status === "sent" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Email 3 (what to expect) has already gone out, so this would arrive after it.
        </p>
      )}

      <details className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" open>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Their booking answers</summary>
        <dl className="grid gap-x-6 gap-y-3 border-t border-zinc-200 px-4 py-3 text-sm sm:grid-cols-2 dark:border-zinc-800">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </details>

      <CaseStudyComposer
        lead={lead}
        initial={initial}
        saveAction={saveEmailSettings.bind(null, lead.id)}
        sendAction={sendCaseStudy.bind(null, lead.id)}
        to={testTo ? `${testTo} (test mode)` : lead.email}
      />
    </div>
  );
}
