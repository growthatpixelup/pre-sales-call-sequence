import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { listReplies } from "@/lib/emails/replies";
import { callStatus, formatDateTime, humaniseEvent } from "@/lib/format";
import { getBooking } from "@/lib/bookings/store";
import { markLeadRepliesRead } from "@/app/dashboard/actions";
import { updateLeadStage } from "@/app/dashboard/leads/actions";
import { CallStatusBadge, StageBadge } from "@/app/dashboard/_components/badges";
import { EmailPersonalisation, LeadEmails, LinkedInNote } from "@/app/dashboard/_components/lead-emails";
import { ReplyList } from "@/app/dashboard/_components/replies";
import { StageSelect } from "@/app/dashboard/_components/stage-select";
import { Empty, Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "@/app/dashboard/_components/ui";

export const metadata: Metadata = { title: "Booking · Dashboard" };

export default function LeadPage({ params }: PageProps<"/dashboard/calls/bookings/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Booking" label="Loading booking" />}>
      <LeadDetail params={params} />
    </Suspense>
  );
}

async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bookingId = decodeURIComponent(id);
  const [lead, replies] = await Promise.all([
    getBooking(bookingId),
    // Replies need migration 005; the page still works without it.
    listReplies({ bookingId }).catch(() => []),
  ]);
  if (!lead) notFound();

  const status = callStatus(lead);
  const unreadReplies = replies.filter((r) => !r.readAt).length;

  return (
    <Page
      rail={
        <>
          <RailIntro title={lead.name} sub={lead.businessName ?? undefined} back={{ href: "/dashboard/calls/bookings", label: "All bookings" }}>
            <div className="mt-5 flex flex-wrap gap-2">
              <CallStatusBadge status={status} />
              {lead.lead && <StageBadge stage={lead.lead.stage} />}
            </div>
          </RailIntro>
          <Rows
            rows={[
              [
                "Stage",
                lead.lead ? (
                  <StageSelect key="stage" compact stage={lead.lead.stage} action={updateLeadStage.bind(null, lead.lead.id)} />
                ) : null,
              ],
              ["Starts", formatDateTime(lead.startTime)],
              ["Ends", formatDateTime(lead.endTime)],
              ["Their zone", lead.timeZone],
              ["Event", lead.eventTitle],
              ["Booked", formatDateTime(lead.bookedAt)],
              ...(lead.cancellationReason ? [["Cancelled", lead.cancellationReason] as [string, string]] : []),
              ["Booking", <span key="id" className="break-all font-mono text-[0.76rem] text-muted">{lead.id}</span>],
            ]}
          />
          <RailActions>
            {lead.meetingUrl && status === "upcoming" ? (
              <a href={lead.meetingUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                Join call
                <Icon name="external" />
              </a>
            ) : (
              <a href={`mailto:${lead.email}`} className="btn-primary">
                Email {lead.name.split(" ")[0]}
                <Icon name="send" />
              </a>
            )}
            {lead.meetingUrl && status === "upcoming" && (
              <a href={`mailto:${lead.email}`} className="btn">
                Email {lead.name.split(" ")[0]}
                <Icon name="send" />
              </a>
            )}
          </RailActions>
        </>
      }
    >
      <Section label="Form answers">
        <Rows
          flush
          wide
          rows={[
            [
              "Email",
              <a key="email" href={`mailto:${lead.email}`} className="link">
                {lead.email}
              </a>,
            ],
            ["Business name", lead.businessName],
            ["Business website", <MaybeLink key="site" href={lead.businessWebsite} />],
            ["What problem are you looking to solve?", lead.problem],
            ["Why did you book this call?", lead.bookingReason],
            ["How much capital have you raised?", lead.capitalRaised],
            ["Expected investment range", lead.investmentRange],
            ["How did you find us?", lead.referralSource],
            ...lead.extraFields.map((f) => [f.label, f.value] as [string, string]),
          ]}
        />
      </Section>

      {Object.values(lead.legacy).some(Boolean) && (
        <Section label="Old form answers">
          <Rows
            flush
            wide
            rows={[
              ...(lead.legacy.phone ? [["Mobile number", lead.legacy.phone] as [string, string]] : []),
              ...(lead.legacy.topic ? [["What is this meeting about", lead.legacy.topic] as [string, string]] : []),
              ...(lead.legacy.notes ? [["Additional notes", lead.legacy.notes] as [string, string]] : []),
              ...(lead.legacy.budget ? [["Budget", lead.legacy.budget] as [string, string]] : []),
              ...(lead.legacy.twitter
                ? [["X / Twitter", <MaybeLink key="x" href={lead.legacy.twitter} />] as [string, ReactNode]]
                : []),
            ]}
          />
        </Section>
      )}

      {replies.length > 0 && (
        <Section
          label={`Replies${unreadReplies > 0 ? ` · ${unreadReplies} unread` : ""}`}
          aside={
            unreadReplies > 1 && (
              <form action={markLeadRepliesRead.bind(null, lead.id)}>
                <button type="submit" className="action">
                  Mark all read
                </button>
              </form>
            )
          }
        >
          <ReplyList replies={replies} />
        </Section>
      )}

      <LeadEmails lead={lead} />

      <Section label="Pipeline lead">
        {lead.lead ? (
          <p className="m-0">
            <Link href={`/dashboard/leads/${lead.lead.id}`} className="action">
              Open lead: stage, prices, next action, notes
              <Icon name="next" />
            </Link>
          </p>
        ) : (
          <Empty>Not in the pipeline (our own or a test booking, or not linked yet: sync with Cal.com).</Empty>
        )}
      </Section>

      <EmailPersonalisation lead={lead} />
      <LinkedInNote lead={lead} />

      <Section label="History">
        <ol className="steps max-w-[68ch]">
          {[...lead.events].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <div>
                <div className="font-medium">{humaniseEvent(e.type)}</div>
                {e.detail && <div className="text-[0.92rem] text-body">{e.detail}</div>}
                <div className="mono-label mt-1">{formatDateTime(e.at)}</div>
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </Page>
  );
}

function MaybeLink({ href }: { href: string | null }) {
  if (!href) return null;
  if (!/^https?:\/\//.test(href)) return <>{href}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link break-all">
      {href}
    </a>
  );
}
