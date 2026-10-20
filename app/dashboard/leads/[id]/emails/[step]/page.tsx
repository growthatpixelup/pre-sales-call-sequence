import type { Metadata } from "next";
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
import { Callout, Page, PageSkeleton, RailIntro, Rows, Section } from "../../../../_components/ui";

export const metadata: Metadata = { title: "Email preview · Dashboard" };

export default function EmailPreviewPage({ params }: PageProps<"/dashboard/leads/[id]/emails/[step]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Email" label="Loading email" />}>
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
    <Page
      rail={
        <>
          <RailIntro title={STEP_LABELS[step as EmailStep]} back={{ href: `/dashboard/leads/${lead.id}`, label: lead.name }} />
          <Rows
            rows={[
              ["From", process.env.EMAIL_FROM ?? "EMAIL_FROM not set"],
              ["To", process.env.EMAIL_TEST_TO ? `${process.env.EMAIL_TEST_TO} (test mode)` : lead.email],
              ["Subject", <span key="subject" className="font-medium">{rendered.subject}</span>],
            ]}
          />
        </>
      }
    >
      <Section wide label="Preview">
        {/* Emails render on white like most mail apps. */}
        <iframe title="Email preview" srcDoc={rendered.html} sandbox="" className="block h-[720px] w-full border-0 bg-white" />
      </Section>
    </Page>
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
    <Page
      rail={
        <>
          <RailIntro
            title={STEP_LABELS.case_study}
            back={{ href: `/dashboard/leads/${lead.id}`, label: lead.name }}
            sub={
              <>
                Pick the case study, write the company line and closing question, check the preview, then send.
              </>
            }
          />
          <Rows
            rows={[
              ["Call", formatDateTime(lead.startTime)],
              ...(email?.status === "draft" && email.dueAt ? [["Send by", formatDateTime(email.dueAt)] as [string, string]] : []),
              ...facts,
            ]}
          />
        </>
      }
    >
      {(problems.length > 0 || (email?.status === "skipped" && email.note) || expect?.status === "sent") && (
        <div className="grid gap-px pt-7">
          {problems.length > 0 && (
            <Callout title="Emails are paused.">
              Until this is set up: {problems.join("; ")}. Sending will queue it until then.
            </Callout>
          )}
          {email?.status === "skipped" && email.note && (
            <Callout title="The sequence skipped this email">
              ({email.note.toLowerCase()}). You can still send it.
            </Callout>
          )}
          {expect?.status === "sent" && (
            <Callout title="Email 3 already went out.">This would arrive after it.</Callout>
          )}
        </div>
      )}

      <CaseStudyComposer
        lead={lead}
        initial={initial}
        saveAction={saveEmailSettings.bind(null, lead.id)}
        sendAction={sendCaseStudy.bind(null, lead.id)}
        to={testTo ? `${testTo} (test mode)` : lead.email}
      />
    </Page>
  );
}
