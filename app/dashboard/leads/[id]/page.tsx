import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { callStatus, formatDateTime, humaniseEvent } from "@/lib/format";
import { getLead } from "@/lib/leads/store";
import { saveInternalNotes, updateStage } from "../../actions";
import { CallStatusBadge, StageBadge } from "../../_components/badges";
import { EmailPersonalisation, LeadEmails, LinkedInNote } from "../../_components/lead-emails";
import { StageSelect } from "../../_components/stage-select";

export const metadata: Metadata = { title: "Lead · Dashboard" };

export default function LeadPage({ params }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <div className="space-y-6">
      <Link
        href="/dashboard"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        ← All leads
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />}>
        <LeadDetail params={params} />
      </Suspense>
    </div>
  );
}

async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLead(decodeURIComponent(id));
  if (!lead) notFound();

  const status = callStatus(lead);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CallStatusBadge status={status} />
            <StageBadge stage={lead.stage} />
          </div>
        </div>
        <StageSelect stage={lead.stage} action={updateStage.bind(null, lead.id)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Form answers">
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Name">{lead.name}</Row>
              <Row label="Email">
                <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {lead.email}
                </a>
              </Row>
              <Row label="Business name">{lead.businessName}</Row>
              <Row label="Business website">
                <MaybeLink href={lead.businessWebsite} />
              </Row>
              <Row label="What problem are you looking to solve?">{lead.problem}</Row>
              <Row label="Why did you book this call?">{lead.bookingReason}</Row>
              <Row label="How much capital have you raised?">{lead.capitalRaised}</Row>
              <Row label="Expected investment range">{lead.investmentRange}</Row>
              <Row label="How did you find us?">{lead.referralSource}</Row>
              {lead.extraFields.map((f) => (
                <Row key={f.key} label={f.label}>
                  {f.value}
                </Row>
              ))}
            </dl>
          </Card>

          {Object.values(lead.legacy).some(Boolean) && (
            <Card title="Old form answers">
              <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lead.legacy.phone && <Row label="Mobile number">{lead.legacy.phone}</Row>}
                {lead.legacy.topic && <Row label="What is this meeting about">{lead.legacy.topic}</Row>}
                {lead.legacy.notes && <Row label="Additional notes">{lead.legacy.notes}</Row>}
                {lead.legacy.budget && <Row label="Budget">{lead.legacy.budget}</Row>}
                {lead.legacy.twitter && (
                  <Row label="X / Twitter">
                    <MaybeLink href={lead.legacy.twitter} />
                  </Row>
                )}
              </dl>
            </Card>
          )}

          <LeadEmails lead={lead} />

          <Card title="Internal notes">
            <form action={saveInternalNotes.bind(null, lead.id)} className="space-y-3 p-4">
              <textarea
                name="internalNotes"
                defaultValue={lead.internalNotes}
                rows={5}
                placeholder="Notes only you can see: follow-ups, call outcome, next steps…"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Save notes
              </button>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Call">
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Starts">{formatDateTime(lead.startTime)}</Row>
              <Row label="Ends">{formatDateTime(lead.endTime)}</Row>
              <Row label="Their time zone">{lead.timeZone}</Row>
              <Row label="Event">{lead.eventTitle}</Row>
              <Row label="Meeting link">
                {lead.meetingUrl ? (
                  <a
                    href={lead.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Join call
                  </a>
                ) : null}
              </Row>
              {lead.cancellationReason && <Row label="Cancellation reason">{lead.cancellationReason}</Row>}
              <Row label="Booking ID">
                <span className="break-all font-mono text-xs">{lead.id}</span>
              </Row>
            </dl>
          </Card>

          <EmailPersonalisation lead={lead} />
          <LinkedInNote lead={lead} />

          <Card title="History">
            <ol className="space-y-3 p-4">
              {[...lead.events].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`} className="text-sm">
                  <div className="font-medium">{humaniseEvent(e.type)}</div>
                  {e.detail && <div className="text-zinc-600 dark:text-zinc-400">{e.detail}</div>}
                  <div className="text-xs text-zinc-500 dark:text-zinc-500">{formatDateTime(e.at)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-800">{title}</h2>
      {children}
    </section>
  );
}

function MaybeLink({ href }: { href: string | null }) {
  if (!href) return null;
  if (!/^https?:\/\//.test(href)) return <>{href}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-blue-600 hover:underline dark:text-blue-400"
    >
      {href}
    </a>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm sm:col-span-2">
        {children ?? <span className="text-zinc-400 dark:text-zinc-600">—</span>}
      </dd>
    </div>
  );
}
