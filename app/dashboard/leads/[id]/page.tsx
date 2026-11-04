import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { listBookingsForLead } from "@/lib/bookings/store";
import type { Booking } from "@/lib/bookings/types";
import { listLeadEmails, type LeadEmail } from "@/lib/emails/queue";
import { listReplies, splitQuoted, type LeadReply } from "@/lib/emails/replies";
import { EMAIL_STEPS, STEP_LABELS } from "@/lib/emails/schedule";
import { callStatus, formatDateTime, formatYmd, humaniseEvent } from "@/lib/format";
import { suggestStakeholders } from "@/lib/kam/leads";
import { listAccounts as listKamAccounts, listStakeholders } from "@/lib/kam/store";
import { KAM_STAGE_LABELS } from "@/lib/kam/types";
import { childLeads, getLead, listActivity } from "@/lib/leads/store";
import {
  ACTIVITY_LABELS,
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  ICP_FITS,
  MANUAL_ACTIVITY,
  ORIGINS,
  ORIGIN_LABELS,
  STAGE_LABELS,
  leadName,
  type Lead,
  type LeadActivity,
} from "@/lib/leads/types";
import { CallStatusBadge, EmailStatusBadge, StageBadge } from "@/app/dashboard/_components/badges";
import { money } from "@/app/dashboard/_components/lead-bits";
import { StageForm } from "@/app/dashboard/_components/stage-form";
import { Callout, Empty, Icon, None, Page, PageSkeleton, RailActions, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";
import { addActivity, saveLead, startProjectDeal, updateLeadStage } from "../actions";
import { attributeLead, unattributeLead } from "@/app/dashboard/kam/actions";
import { StakeholderSelect } from "@/app/dashboard/kam/_components/bits";

export const metadata: Metadata = { title: "Lead · GTM OS" };

export default function LeadPage({ params, searchParams }: PageProps<"/dashboard/leads/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Lead" label="Loading lead" />}>
      <LeadDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

interface BookingWithEmails {
  booking: Booking;
  emails: LeadEmail[];
  replies: LeadReply[];
}

async function LeadDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const lead = await getLead(id);
  if (!lead) notFound();

  const [activity, bookings, children, parent, kam] = await Promise.all([
    listActivity(lead.id),
    listBookingsForLead(lead.id),
    childLeads(lead.id),
    lead.parentLeadId ? getLead(lead.parentLeadId) : null,
    // KAM needs migration 011; the lead page works without it.
    Promise.all([listStakeholders(), listKamAccounts()]).catch(() => null),
  ]);
  const calls: BookingWithEmails[] = await Promise.all(
    bookings.map(async (booking) => ({
      booking,
      emails: await listLeadEmails(booking.id),
      replies: await listReplies({ bookingId: booking.id }).catch(() => []),
    })),
  );
  const matched = typeof sp.matched === "string" ? sp.matched : null;
  const first = lead.contactName.split(" ")[0] || "them";

  return (
    <Page
      rail={
        <>
          <RailIntro
            title={leadName(lead)}
            sub={lead.contactName && lead.company ? lead.company : undefined}
            back={{ href: "/dashboard/pipeline", label: "Pipeline" }}
          >
            <div className="mt-5 flex flex-wrap gap-2">
              <StageBadge stage={lead.stage} />
              <Tag tone="neutral">{ORIGIN_LABELS[lead.origin]}</Tag>
              <Tag tone="neutral">{DEAL_TYPE_LABELS[lead.dealType]}</Tag>
            </div>
          </RailIntro>
          <Rows
            rows={[
              ["Stage", <StageForm key="stage" stage={lead.stage} reason={lead.exitReason} action={updateLeadStage.bind(null, lead.id)} />],
              ...(lead.exitReason ? [["Reason", lead.exitReason] as [string, string]] : []),
              ["Value", money(lead)],
              ["Next action", nextAction(lead)],
              ["Owner", lead.owner],
              ["Last touch", lead.lastTouchAt ? formatDateTime(lead.lastTouchAt) : null],
              ["In stage since", lead.stageChangedAt ? formatDateTime(lead.stageChangedAt) : null],
              ["Created", formatDateTime(lead.createdAt)],
            ]}
          />
          <RailActions>
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="btn-primary">
                Email {first}
                <Icon name="send" />
              </a>
            )}
            {lead.linkedinUrl && (
              <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="btn">
                LinkedIn
                <Icon name="external" />
              </a>
            )}
            {lead.dealType === "audit" && lead.stage === "paid" && (
              <form action={startProjectDeal.bind(null, lead.id)} className="grid">
                <button type="submit" className="btn">
                  Start the project deal
                  <Icon name="next" />
                </button>
              </form>
            )}
          </RailActions>
        </>
      }
    >
      {matched && (
        <div className="pt-7">
          <Callout title="Already in the pipeline.">
            What you added matched this lead on {matched === "linkedin" ? "LinkedIn URL" : matched}, so no new lead was
            created. The first touch is in the timeline.
          </Callout>
        </div>
      )}

      <Section label="Deal">
        <form action={saveLead.bind(null, lead.id)} className="form-grid">
          <Select name="dealType" label="Deal type" value={lead.dealType} options={DEAL_TYPES.map((d) => [d, DEAL_TYPE_LABELS[d]])} />
          <Field name="owner" label="Owner" value={lead.owner} placeholder="e.g. Daksh" />
          <Field name="estimatedPrice" label="Estimated price (USD)" value={lead.estimatedPrice} inputMode="decimal" />
          <Field name="closedPrice" label="Closed price (USD)" value={lead.closedPrice} inputMode="decimal" />
          <Field name="nextAction" label="Next action" value={lead.nextAction} placeholder="e.g. Send revised proposal" wide />
          <Field name="nextActionDue" label="Due" value={lead.nextActionDue} type="date" />
          <Field name="proposalUrl" label="Proposal link" value={lead.proposalUrl} type="url" />
          <Field name="transcriptUrl" label="Call transcript (Fireflies)" value={lead.transcriptUrl} type="url" wide />
          <Save />
        </form>
      </Section>

      <Section label="Log a touch" aside={<p className="hint m-0">DMs, emails and calls move “last touch”. Notes don&apos;t.</p>}>
        <form action={addActivity.bind(null, lead.id)} className="form-grid">
          <Select name="type" label="Type" value="dm" options={MANUAL_ACTIVITY.map((t) => [t, ACTIVITY_LABELS[t]])} />
          <Field name="date" label="When" value={null} type="date" />
          <label className="field form-wide">
            <span className="mono-label">What happened</span>
            <textarea name="detail" rows={2} required className="input" placeholder="e.g. Replied on LinkedIn, wants a call next week" />
          </label>
          <div className="form-wide">
            <button type="submit" className="btn">
              Log it
            </button>
          </div>
        </form>
      </Section>

      <Section label="Timeline">
        <Timeline activity={activity} calls={calls} />
      </Section>

      <Section label={`Calls · ${calls.length}`}>
        {calls.length ? <Calls calls={calls} /> : <Empty>No calls booked through Cal.com yet.</Empty>}
      </Section>

      <Section label="Who">
        <form action={saveLead.bind(null, lead.id)} className="form-grid">
          <Field name="contactName" label="Contact" value={lead.contactName} />
          <Field name="role" label="Role" value={lead.role} />
          <Field name="company" label="Company" value={lead.company} />
          <Field name="email" label="Email" value={lead.email} type="email" />
          <Field name="linkedinUrl" label="LinkedIn URL" value={lead.linkedinUrl} />
          <Field name="fundingStage" label="Funding stage" value={lead.fundingStage} placeholder="e.g. Seed, $3M" />
          <Select
            name="icpFit"
            label="ICP fit"
            value={lead.icpFit ?? ""}
            options={[["", "Not rated"], ...ICP_FITS.map((f) => [f, f[0].toUpperCase() + f.slice(1)] as [string, string])]}
          />
          <div className="field">
            <span className="mono-label">Company domain</span>
            <span className="py-2 text-body">{lead.domain ?? <None />}</span>
          </div>
          <Save />
        </form>
      </Section>

      <Section label="Origin" aside={<p className="hint m-0">First touch. Channels are credited from this.</p>}>
        <form action={saveLead.bind(null, lead.id)} className="form-grid">
          <Select name="origin" label="Source" value={lead.origin} options={ORIGINS.map((o) => [o, ORIGIN_LABELS[o]])} />
          <Field name="originDetail" label="Sub-source" value={lead.originDetail} placeholder="Account, campaign, referrer, job" />
          <Field name="bookingSource" label="Booking source" value={lead.bookingSource} placeholder="“How did you find us?” answer" wide />
          <Save />
        </form>
      </Section>

      {kam && <KamSection leadId={lead.id} lead={lead} stakeholders={kam[0]} accounts={kam[1]} />}

      {(parent || children.length > 0) && (
        <Section label="Related deals">
          <ul className="list">
            {[...(parent ? [{ lead: parent, label: "Audit this came from" }] : []), ...children.map((c) => ({ lead: c, label: "Project deal" }))].map(
              ({ lead: other, label }) => (
                <li key={other.id}>
                  <div className="item">
                    <div className="min-w-0">
                      <p className="mono-label m-0">{label}</p>
                      <Link href={`/dashboard/leads/${other.id}`} className="item-title mt-2 inline-block">
                        {leadName(other)} · {DEAL_TYPE_LABELS[other.dealType]}
                      </Link>
                      <p className="m-0 mt-1 text-[0.92rem] text-muted">
                        {STAGE_LABELS[other.stage]} · {money(other)}
                      </p>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        </Section>
      )}

      <Section label="Notes">
        <form action={saveLead.bind(null, lead.id)} className="grid max-w-[68ch] gap-5">
          <textarea
            name="notes"
            defaultValue={lead.notes}
            rows={6}
            aria-label="Notes"
            placeholder="Context, call outcome, what they care about…"
            className="input"
          />
          <button type="submit" className="btn justify-self-start">
            Save notes
          </button>
        </form>
      </Section>
    </Page>
  );
}

function nextAction(lead: Lead) {
  if (!lead.nextAction && !lead.nextActionDue) return null;
  return [lead.nextAction, lead.nextActionDue && `due ${formatYmd(lead.nextActionDue)}`].filter(Boolean).join(" · ");
}

function Field({
  name,
  label,
  value,
  type = "text",
  placeholder,
  inputMode,
  wide = false,
}: {
  name: string;
  label: string;
  value: string | number | null;
  type?: "text" | "email" | "url" | "date";
  placeholder?: string;
  inputMode?: "decimal";
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "form-wide" : ""}`}>
      <span className="mono-label">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`input ${inputMode ? "tabular-nums" : ""}`}
      />
    </label>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <select name={name} defaultValue={value} className="input">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Save() {
  return (
    <div className="form-wide">
      <button type="submit" className="btn">
        Save
      </button>
    </div>
  );
}

interface TimelineItem {
  key: string;
  at: string;
  title: string;
  detail?: ReactNode;
}

/** The lead's own activity, plus pre-call emails sent and replies to them, newest first. */
function Timeline({ activity, calls }: { activity: LeadActivity[]; calls: BookingWithEmails[] }) {
  const items: TimelineItem[] = [
    ...activity.map((a) => ({
      key: `a-${a.id}`,
      at: a.at,
      title: ACTIVITY_LABELS[a.type] ?? humaniseEvent(a.type),
      detail:
        a.type === "project_spawned" && a.detail ? (
          <Link href={`/dashboard/leads/${a.detail}`} className="link">
            Open the project deal
          </Link>
        ) : (
          a.detail
        ),
    })),
    ...calls.flatMap(({ emails, replies }) => [
      ...emails
        .filter((e) => e.status === "sent" && e.sentAt)
        .map((e) => ({ key: `e-${e.id}`, at: e.sentAt!, title: `Sequence email sent: ${STEP_LABELS[e.step]}`, detail: e.subject })),
      ...replies.map((r) => ({
        key: `r-${r.id}`,
        at: r.receivedAt,
        title: `Replied: ${r.subject || "(no subject)"}`,
        detail: <span className="line-clamp-3">{splitQuoted(r.text).body}</span>,
      })),
    ]),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  if (!items.length) return <Empty>Nothing yet.</Empty>;
  return (
    <ol className="steps max-w-[68ch]">
      {items.map((item) => (
        <li key={item.key}>
          <div>
            <div className="font-medium">{item.title}</div>
            {item.detail && <div className="text-[0.92rem] text-body">{item.detail}</div>}
            <div className="mono-label mt-1">{formatDateTime(item.at)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Calls({ calls }: { calls: BookingWithEmails[] }) {
  return (
    <ul className="list">
      {calls.map(({ booking, emails }) => (
        <li key={booking.id}>
          <div className="item">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CallStatusBadge status={callStatus(booking)} />
              </div>
              <Link href={`/dashboard/calls/bookings/${booking.id}`} className="item-title mt-3 inline-block">
                {formatDateTime(booking.startTime)}
              </Link>
              <p className="m-0 mt-1 text-[0.92rem] text-muted">
                Booked {formatDateTime(booking.bookedAt)}
                {booking.referralSource ? ` · found us: ${booking.referralSource}` : ""}
              </p>
              {(booking.problem ?? booking.bookingReason) && (
                <p className="m-0 mt-3 max-w-[68ch] text-[0.92rem] text-body">{booking.problem ?? booking.bookingReason}</p>
              )}
              {emails.length > 0 && (
                <ul className="mt-4 grid gap-1.5 text-[0.85rem]">
                  {EMAIL_STEPS.map((step) => {
                    const email = emails.find((e) => e.step === step);
                    if (!email) return null;
                    return (
                      <li key={step} className="flex flex-wrap items-center gap-2">
                        <span className="w-56 text-muted">{STEP_LABELS[step]}</span>
                        <EmailStatusBadge status={email.status} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="item-actions">
              <Link href={`/dashboard/calls/bookings/${booking.id}`} className="action">
                Booking
                <Icon name="next" />
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function KamSection({
  leadId,
  lead,
  stakeholders,
  accounts,
}: {
  leadId: string;
  lead: Lead;
  stakeholders: Awaited<ReturnType<typeof listStakeholders>>;
  accounts: Awaited<ReturnType<typeof listKamAccounts>>;
}) {
  const linked = stakeholders.filter((s) => s.leadId === leadId);
  const company = new Map(accounts.map((a) => [a.id, a.company]));
  if (linked.length) {
    return (
      <Section label="KAM">
        <ul className="list">
          {linked.map((s) => (
            <li key={s.id}>
              <div className="item">
                <div className="min-w-0">
                  <Link href={`/dashboard/kam/accounts/${s.accountId}`} className="item-title">
                    {s.name} · {company.get(s.accountId)}
                  </Link>
                  <p className="m-0 mt-1 text-[0.92rem] text-muted">{KAM_STAGE_LABELS[s.stage]}</p>
                </div>
                <div className="item-actions">
                  <form action={unattributeLead.bind(null, s.id)}>
                    <button type="submit" className="action">
                      Unlink
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    );
  }
  if (!stakeholders.length) return null;
  const suggested = suggestStakeholders(lead, stakeholders, accounts);
  return (
    <Section label="KAM" aside={<p className="hint m-0">Link this lead to the stakeholder the team warmed up. Its Source becomes KAM.</p>}>
      <form action={attributeLead.bind(null, leadId)} className="grid max-w-[68ch] gap-3">
        <StakeholderSelect stakeholders={stakeholders} accounts={accounts} label="Attribute to" required first={suggested} />
        <button type="submit" className="action justify-self-start">
          Attribute to KAM
        </button>
      </form>
    </Section>
  );
}
