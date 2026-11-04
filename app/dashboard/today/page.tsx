import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDateTime, formatYmd } from "@/lib/format";
import { SILENT_DAYS, daysSince, loadToday, type TodayView } from "@/lib/leads/today";
import { leadName } from "@/lib/leads/types";
import { LeadItem } from "@/app/dashboard/_components/lead-bits";
import { TaskList } from "@/app/dashboard/_components/task-list";
import { Empty, Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";

export const metadata: Metadata = { title: "Today · GTM OS" };

const TITLE = "Today";
const SUB = "What to do now: today's calls, emails and notes before calls, follow-ups that are due, and leads going quiet.";

export default function TodayPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading today" />}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  // Everything here depends on the current time.
  await connection();
  const view = await loadView();
  const { callsToday, emailTasks, linkedInTasks, stuckEmails, nextActions, silent, proposals } = view;

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Calls today", <Count key="calls" n={callsToday.length} />],
              ["Emails to personalise", <Count key="emails" n={emailTasks.length} />],
              ["LinkedIn notes", <Count key="linkedin" n={linkedInTasks.length} />],
              ["Follow-ups due", <Count key="due" n={nextActions.length} />],
              [`Silent ${SILENT_DAYS}+ days`, <Count key="silent" n={silent.length} />],
              ["Proposals out", <Count key="proposals" n={proposals.length} />],
            ]}
          />
          <RailActions>
            <Link href="/dashboard/pipeline" className="btn-primary">
              Pipeline
              <Icon name="next" />
            </Link>
            <Link href="/dashboard/leads/new" className="btn">
              Add a lead
              <Icon name="next" />
            </Link>
          </RailActions>
        </>
      }
    >
      <Section label={`Calls today · ${callsToday.length}`}>
        {callsToday.length ? <CallsToday calls={callsToday} /> : <Empty>No calls today.</Empty>}
      </Section>

      <Section label={`Emails to personalise · ${emailTasks.length}`}>
        {emailTasks.length ? <TaskList tasks={emailTasks} /> : <Empty>No pre-call emails waiting on you.</Empty>}
      </Section>

      <Section label={`LinkedIn notes to send · ${linkedInTasks.length}`}>
        {linkedInTasks.length ? <TaskList tasks={linkedInTasks} /> : <Empty>Every upcoming call has had its note.</Empty>}
      </Section>

      {stuckEmails.length > 0 && (
        <Section label={`Stuck emails · ${stuckEmails.length}`}>
          <TaskList tasks={stuckEmails} />
        </Section>
      )}

      <Section label={`Follow-ups due · ${nextActions.length}`} aside={<p className="hint m-0">Next actions due today or earlier.</p>}>
        {nextActions.length ? (
          <ul className="list">
            {nextActions.map((lead) => (
              <li key={lead.id} className={lead.nextActionDue! < view.today ? "item-picked" : undefined}>
                <LeadItem
                  lead={lead}
                  meta={
                    <>
                      {lead.nextActionDue! < view.today ? <Tag>Overdue</Tag> : <Tag tone="neutral">Today</Tag>}{" "}
                      {lead.nextAction ?? "Next action"} · due {formatYmd(lead.nextActionDue!)}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nothing due.</Empty>
        )}
      </Section>

      <Section
        label={`Silent ${SILENT_DAYS}+ days · ${view.silent.length}`}
        aside={<p className="hint m-0">Open leads with no touch for {SILENT_DAYS} days and no call ahead.</p>}
      >
        {silent.length ? (
          <ul className="list">
            {silent.map((lead) => (
              <li key={lead.id}>
                <LeadItem lead={lead} meta={quietFor(lead.lastTouchAt ?? lead.createdAt, view.nowMs)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nobody&apos;s gone quiet.</Empty>
        )}
      </Section>

      <Section label={`Proposals awaiting a reply · ${proposals.length}`}>
        {proposals.length ? (
          <ul className="list">
            {proposals.map((lead) => (
              <li key={lead.id}>
                <LeadItem
                  lead={lead}
                  meta={
                    <>
                      Sent {quietFor(lead.stageChangedAt ?? lead.updatedAt, view.nowMs, "ago")}
                      {lead.proposalUrl && (
                        <>
                          {" · "}
                          <a href={lead.proposalUrl} target="_blank" rel="noopener noreferrer" className="link">
                            Proposal
                          </a>
                        </>
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No proposals out.</Empty>
        )}
      </Section>
    </Page>
  );
}

/** Kept outside the component because it reads the clock. */
async function loadView(): Promise<TodayView & { nowMs: number }> {
  const now = new Date();
  return { ...(await loadToday(now)), nowMs: now.getTime() };
}

function quietFor(iso: string, nowMs: number, suffix = "since the last touch") {
  const days = daysSince(iso, nowMs);
  return `${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} ${days === 0 ? "" : suffix}`.trim();
}

function CallsToday({ calls }: { calls: TodayView["callsToday"] }) {
  return (
    <ul className="list">
      {calls.map(({ booking, lead }) => (
        <li key={booking.id}>
          <div className="item">
            <div className="min-w-0">
              <p className="mono-label m-0">{formatDateTime(booking.startTime)}</p>
              <Link
                href={lead ? `/dashboard/leads/${lead.id}` : `/dashboard/calls/bookings/${booking.id}`}
                className="item-title mt-2 inline-block"
              >
                {lead ? leadName(lead) : booking.name}
              </Link>
              <p className="m-0 mt-1 text-[0.92rem] text-muted">
                {[booking.businessName, booking.investmentRange, booking.referralSource && `Found us: ${booking.referralSource}`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {(booking.problem ?? booking.legacy.topic) && (
                <p className="m-0 mt-3 max-w-[68ch] text-[0.92rem] text-body">
                  <span className="mono-label">Problem </span>
                  {booking.problem ?? booking.legacy.topic}
                </p>
              )}
              {booking.bookingReason && (
                <p className="m-0 mt-2 max-w-[68ch] text-[0.92rem] text-body">
                  <span className="mono-label">Why they booked </span>
                  {booking.bookingReason}
                </p>
              )}
            </div>
            <div className="item-actions">
              {booking.meetingUrl && (
                <a href={booking.meetingUrl} target="_blank" rel="noopener noreferrer" className="action">
                  Join
                  <Icon name="external" />
                </a>
              )}
              <Link href={`/dashboard/calls/bookings/${booking.id}`} className="action">
                Booking
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Count({ n }: { n: number }) {
  return <span className={`tabular-nums ${n ? "" : "text-hint"}`}>{n}</span>;
}
