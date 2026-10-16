import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { listLeadEmails } from "@/lib/emails/queue";
import { EMAIL_STEPS, STEP_LABELS, type EmailStep } from "@/lib/emails/schedule";
import { emailContext } from "@/lib/emails/sender";
import { renderEmail } from "@/lib/emails/templates";
import { getLead } from "@/lib/leads/store";

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
