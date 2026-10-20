import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { estimatedValue, formatMoney } from "@/lib/analytics";
import { listReplies } from "@/lib/emails/replies";
import { callStatus, formatDateTime, humaniseEvent } from "@/lib/format";
import { getLead } from "@/lib/leads/store";
import { markLeadRepliesRead, saveDealValue, saveInternalNotes, updateStage } from "../../actions";
import { CallStatusBadge, StageBadge } from "../../_components/badges";
import { EmailPersonalisation, LeadEmails, LinkedInNote } from "../../_components/lead-emails";
import { ReplyList } from "../../_components/replies";
import { StageSelect } from "../../_components/stage-select";
import { Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "../../_components/ui";

export const metadata: Metadata = { title: "Lead · Dashboard" };

export default function LeadPage({ params }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Lead" label="Loading lead" />}>
      <LeadDetail params={params} />
    </Suspense>
  );
}

async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = decodeURIComponent(id);
  const [lead, replies] = await Promise.all([
    getLead(leadId),
    // Replies need migration 005; the page still works without it.
    listReplies({ leadId }).catch(() => []),
  ]);
  if (!lead) notFound();

  const status = callStatus(lead);
  const estimate = estimatedValue(lead);
  const unreadReplies = replies.filter((r) => !r.readAt).length;

  return (
    <Page
      rail={
        <>
          <RailIntro title={lead.name} sub={lead.businessName ?? undefined} back={{ href: "/dashboard/leads", label: "All leads" }}>
            <div className="mt-5 flex flex-wrap gap-2">
              <CallStatusBadge status={status} />
              <StageBadge stage={lead.stage} />
            </div>
          </RailIntro>
          <Rows
            rows={[
              ["Stage", <StageSelect key="stage" compact stage={lead.stage} action={updateStage.bind(null, lead.id)} />],
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

      <Section label="Deal">
        <form action={saveDealValue.bind(null, lead.id)} className="grid max-w-[68ch] gap-5">
          <label className="field">
            <span className="mono-label">Deal value (USD)</span>
            <input
              name="dealValue"
              inputMode="decimal"
              defaultValue={lead.dealValue ?? ""}
              placeholder={estimate != null ? String(estimate) : "e.g. 12000"}
              className="input tabular-nums"
            />
            <span className="hint">
              {estimate != null
                ? `Leave empty to use ${formatMoney(estimate)}, the middle of their investment range.`
                : "Their investment range doesn't give a number, so this lead counts as $0 until you set one."}
            </span>
          </label>
          <button type="submit" className="btn">
            Save value
          </button>
        </form>
      </Section>

      <Section label="Internal notes">
        <form action={saveInternalNotes.bind(null, lead.id)} className="grid max-w-[68ch] gap-5">
          <textarea
            name="internalNotes"
            defaultValue={lead.internalNotes}
            rows={5}
            aria-label="Internal notes"
            placeholder="Notes only you can see: follow-ups, call outcome, next steps…"
            className="input"
          />
          <button type="submit" className="btn">
            Save notes
          </button>
        </form>
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
