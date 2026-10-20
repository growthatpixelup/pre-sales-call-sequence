import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import type { EmailStatus, LeadEmail } from "@/lib/emails/queue";
import { EMAIL_STEPS, STEP_LABELS } from "@/lib/emails/schedule";
import { emailSetupProblems } from "@/lib/emails/sender";
import { formatDateTime } from "@/lib/format";
import type { Lead } from "@/lib/leads/types";
import { loadTasks } from "@/lib/tasks";
import { EmailStatusBadge } from "../_components/badges";
import { TaskList } from "../_components/task-list";
import { Callout, Empty, Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "../_components/ui";

export const metadata: Metadata = { title: "Emails · Dashboard" };

const TITLE = "Emails";
const SUB = "What the sequence sent, what's queued, and what needs you.";
const DAYS = 30;
/** Scheduled emails this late mean the cron isn't running. */
const OVERDUE_MS = 15 * 60_000;

export default function EmailsPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading emails" />}>
      <Emails />
    </Suspense>
  );
}

async function Emails() {
  // Overdue and "last 30 days" depend on the current time.
  await connection();
  const { tasks: allTasks, leads, emails } = await loadTasks(since());
  const view = buildView(leads, emails);
  // LinkedIn notes live on the Tasks page; here only email work counts.
  const tasks = allTasks.filter((t) => t.kind !== "linkedin");
  const problems = emailSetupProblems();
  const testTo = process.env.EMAIL_TEST_TO;

  const firstDraft = view.drafts[0];
  const status = problems.length ? "Paused" : testTo ? "Test mode" : "Sending";

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Status", <span key="status" className={problems.length ? "text-muted" : undefined}>{status}</span>],
              ["Needs you", <Count key="needs" n={tasks.length} />],
              ["Queued", <Count key="queued" n={view.scheduled.length} />],
              [`Sent, ${DAYS}d`, <Count key="sent" n={view.sent.length} />],
              [`Failed`, <Count key="failed" n={view.failed.length} />],
            ]}
          />
          <RailActions>
            {firstDraft ? (
              <Link href={`/dashboard/leads/${firstDraft.leadId}/emails/case_study`} className="btn-primary">
                Prepare next Email 1
                <Icon name="send" />
              </Link>
            ) : null}
            <Link href="/dashboard/leads?status=upcoming" className="btn">
              Upcoming calls
              <Icon name="next" />
            </Link>
          </RailActions>
        </>
      }
    >
      {(problems.length > 0 || testTo) && (
        <div className="grid gap-px pt-7">
          {problems.length > 0 && (
            <Callout title="Emails are paused.">
              Nothing sends until this is fixed; scheduled emails wait.
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

      <Section
        label={`Needs you · ${tasks.length}`}
        aside={
          <Link href="/dashboard/tasks" className="action">
            All tasks
            <Icon name="next" />
          </Link>
        }
      >
        {tasks.length ? (
          <TaskList tasks={tasks} />
        ) : (
          <Empty>All clear. No drafts to prepare, nothing failed or overdue.</Empty>
        )}
      </Section>

      <Section label={`By email, last ${DAYS} days`}>
        <StepTable activity={view.recentByStep} />
      </Section>

      <Section label={`Going out next · ${view.scheduled.length}`}>
        {view.scheduled.length ? (
          <EmailList emails={view.scheduled.slice(0, 15)} lead={view.lead} when={(e) => `Due ${formatDateTime(e.dueAt!)}`} />
        ) : (
          <Empty>Nothing scheduled.</Empty>
        )}
      </Section>

      <Section label={`Sent · last ${DAYS} days`}>
        {view.sent.length ? (
          <EmailList emails={view.sent.slice(0, 25)} lead={view.lead} when={(e) => `Sent ${formatDateTime(e.sentAt!)}`} />
        ) : (
          <Empty>Nothing sent in the last {DAYS} days.</Empty>
        )}
        {view.sent.length > 25 && <p className="hint m-0 mt-3">Showing the latest 25 of {view.sent.length}.</p>}
      </Section>
    </Page>
  );
}

function since() {
  // Kept apart from the component because it reads the clock.
  return new Date(Date.now() - DAYS * 86_400_000);
}

/** Splits the activity into what the page shows. Kept outside the component because it reads the clock. */
function buildView(leads: Lead[], activity: LeadEmail[]) {
  const now = Date.now();
  const since = now - DAYS * 86_400_000;
  const leadsById = new Map(leads.map((l) => [l.id, l]));
  // Emails of deleted, internal or test leads aren't shown.
  const emails = activity.filter((e) => leadsById.has(e.leadId));
  const lead = (e: LeadEmail) => leadsById.get(e.leadId)!;
  const upcomingCall = (e: LeadEmail) => lead(e).bookingStatus === "accepted" && Date.parse(lead(e).startTime) > now;
  // Scheduled emails this late show up as overdue tasks instead.
  const scheduled = emails
    .filter((e) => e.status === "scheduled" && e.dueAt)
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  const recent = emails.filter((e) => e.status !== "sent" || (e.sentAt && Date.parse(e.sentAt) >= since));

  const recentByStep = EMAIL_STEPS.map((step) => {
    const counts: Partial<Record<EmailStatus, number>> = {};
    for (const e of recent) if (e.step === step) counts[e.status] = (counts[e.status] ?? 0) + 1;
    return { step, counts };
  });

  return {
    lead,
    scheduled: scheduled.filter((e) => Date.parse(e.dueAt!) > now - OVERDUE_MS),
    drafts: emails.filter((e) => e.status === "draft" && upcomingCall(e)).sort((a, b) => Date.parse(a.dueAt ?? "") - Date.parse(b.dueAt ?? "")),
    failed: emails.filter((e) => e.status === "failed"),
    sent: emails
      .filter((e) => e.status === "sent" && e.sentAt && Date.parse(e.sentAt) >= since)
      .sort((a, b) => Date.parse(b.sentAt!) - Date.parse(a.sentAt!)),
    recentByStep,
  };
}

const COLUMNS: { status: EmailStatus; label: string }[] = [
  { status: "sent", label: "Sent" },
  { status: "scheduled", label: "Queued" },
  { status: "draft", label: "Drafts" },
  { status: "skipped", label: "Skipped" },
  { status: "cancelled", label: "Cancelled" },
  { status: "failed", label: "Failed" },
];

function StepTable({ activity }: { activity: { step: (typeof EMAIL_STEPS)[number]; counts: Partial<Record<EmailStatus, number>> }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-max">
        <thead>
          <tr>
            <th>Email</th>
            {COLUMNS.map((c) => (
              <th key={c.status} className="text-right">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activity.map(({ step, counts }) => (
            <tr key={step}>
              <td className="whitespace-nowrap text-text">{STEP_LABELS[step]}</td>
              {COLUMNS.map((c) => {
                const n = counts[c.status] ?? 0;
                const alert = n > 0 && (c.status === "failed" || c.status === "draft");
                return (
                  <td key={c.status} className={`text-right tabular-nums ${n ? (alert ? "font-medium text-text" : "") : "text-hint"}`}>
                    {alert && <span className="mr-1.5 inline-block size-1.5 bg-blue align-middle" aria-hidden />}
                    {n || "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint m-0 mt-3">
        Skipped emails didn&apos;t fit before the call (booked too late, or Email 1 not sent in time).
      </p>
    </div>
  );
}

function EmailList({
  emails,
  lead,
  when,
}: {
  emails: LeadEmail[];
  lead: (e: LeadEmail) => Lead;
  when: (e: LeadEmail) => string;
}) {
  return (
    <ul className="list">
      {emails.map((e) => (
        <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-3">
          <span className="min-w-0">
            <Link href={`/dashboard/leads/${e.leadId}`} className="link">
              {lead(e).name}
            </Link>
            <span className="text-muted"> · {STEP_LABELS[e.step]}</span>
          </span>
          <span className="hidden sm:inline">
            <EmailStatusBadge status={e.status} />
          </span>
          <span className="col-span-2 text-[0.85rem] text-hint">{when(e)}</span>
        </li>
      ))}
    </ul>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tabular-nums">{n}</span>;
}
