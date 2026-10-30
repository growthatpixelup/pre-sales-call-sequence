import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { formatMoney, leadValue } from "@/lib/analytics";
import { callStatus, formatDateTime, type CallStatus } from "@/lib/format";
import { listLeads } from "@/lib/leads/store";
import { LEAD_STAGES, type Lead } from "@/lib/leads/types";
import { updateStage } from "../actions";
import { CallStatusBadge, STAGE_LABELS } from "../_components/badges";
import { SyncButton } from "../_components/sync-button";
import { StageSelect } from "../_components/stage-select";
import { None, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "../_components/ui";

export const metadata: Metadata = { title: "Leads · Dashboard" };

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const TITLE = "Leads";
const SUB = "Everyone who booked a call through Cal.com, with their form answers.";

export default function LeadsPage({ searchParams }: PageProps<"/dashboard/leads">) {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading leads" />}>
      <LeadsView searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function LeadsView({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = param(sp.q)?.trim() ?? "";
  const status = param(sp.status) ?? "all";
  const stage = param(sp.stage) ?? "all";

  const leads = await listLeads();
  const { filtered, stats } = buildView(leads, { q, status, stage });

  const hrefWith = (changes: Record<string, string>) => {
    const next = new URLSearchParams();
    const merged = { q, status, stage, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") next.set(k, v);
    const s = next.toString();
    return s ? `/dashboard/leads?${s}` : "/dashboard/leads";
  };

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows rows={stats.map((st) => [st.label, <span key={st.label} className="tabular-nums">{st.value}</span>])} />
          {process.env.CAL_API_KEY ? (
            <RailActions>
              <SyncButton primary />
            </RailActions>
          ) : null}
        </>
      }
    >
      <Section
        wide
        label={`${filtered.length} ${filtered.length === 1 ? "lead" : "leads"}`}
        aside={
          <form action="/dashboard/leads" className="flex flex-wrap gap-2">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, email, business…"
              aria-label="Search leads"
              className="input input-sm min-w-0 flex-1 sm:w-64 sm:flex-none"
            />
            <select name="stage" defaultValue={stage} aria-label="Filter by stage" className="input input-sm">
              <option value="all">All stages</option>
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <button type="submit" className="action">
              Filter
            </button>
          </form>
        }
      >
        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Call status">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={hrefWith({ status: tab.value })}
              aria-current={status === tab.value ? "page" : undefined}
              className="chip"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {filtered.length === 0 ? <EmptyState hasLeads={leads.length > 0} /> : <LeadsTable rows={filtered} />}
      </Section>
    </Page>
  );
}

/** Filters and summarises leads. Kept outside the component because it reads the clock. */
function buildView(leads: Lead[], filters: { q: string; status: string; stage: string }) {
  const { q, status, stage } = filters;
  const now = Date.now();
  const withStatus = leads.map((lead) => ({ lead, status: callStatus(lead, now) }));

  const filtered = withStatus.filter(({ lead, status: s }) => {
    if (status === "cancelled" ? s !== "cancelled" && s !== "rejected" : status !== "all" && s !== status) {
      return false;
    }
    if (stage !== "all" && lead.stage !== stage) return false;
    if (!q) return true;
    const haystack = [
      lead.name,
      lead.email,
      lead.businessName,
      lead.businessWebsite,
      lead.problem,
      lead.bookingReason,
      lead.referralSource,
      lead.legacy.topic,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q.toLowerCase());
  });

  // Upcoming calls read best soonest-first; everything else newest-first.
  if (status === "upcoming") filtered.reverse();

  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const stats = [
    { label: "Total", value: leads.length },
    { label: "Upcoming", value: withStatus.filter((l) => l.status === "upcoming").length },
    { label: "Last 7 days", value: leads.filter((l) => Date.parse(l.bookedAt) > weekAgo).length },
    { label: "Won", value: leads.filter((l) => l.stage === "won").length },
  ];

  return { filtered, stats };
}

// The pinned name column needs its own background so scrolled cells don't show through.
const STICKY = "sticky left-0 z-10 bg-bg pl-0 shadow-[1px_0_0_0_var(--line)]";
const STICKY_BODY = `${STICKY} group-hover:bg-panel`;

type Row = { lead: Lead; status: CallStatus };

/** Table columns: every Cal.com form answer, in the order the form asks them, then the call. */
const COLUMNS: { label: string; cell: (row: Row) => ReactNode; className?: string }[] = [
  {
    label: "Name",
    className: `${STICKY_BODY} whitespace-nowrap`,
    cell: ({ lead }) => (
      <Link
        href={`/dashboard/leads/${lead.id}`}
        className="link font-medium no-underline hover:underline"
      >
        {lead.name}
      </Link>
    ),
  },
  {
    label: "Email",
    className: "whitespace-nowrap",
    cell: ({ lead }) => (
      <a href={`mailto:${lead.email}`} className="link">
        {lead.email}
      </a>
    ),
  },
  { label: "Business name", className: "max-w-48", cell: ({ lead }) => <Answer value={lead.businessName} /> },
  { label: "Website", className: "max-w-56", cell: ({ lead }) => <Website url={lead.businessWebsite} /> },
  {
    label: "Problem to solve",
    className: "w-72 min-w-72 max-w-72",
    cell: ({ lead }) => <Answer value={lead.problem ?? lead.legacy.topic} lines={3} />,
  },
  {
    label: "Why they booked",
    className: "w-72 min-w-72 max-w-72",
    cell: ({ lead }) => <Answer value={lead.bookingReason} lines={3} />,
  },
  { label: "Capital raised", className: "max-w-48", cell: ({ lead }) => <Answer value={lead.capitalRaised} /> },
  {
    label: "Investment range",
    className: "max-w-48",
    cell: ({ lead }) => <Answer value={lead.investmentRange ?? lead.legacy.budget} />,
  },
  { label: "How they found us", className: "max-w-48", cell: ({ lead }) => <Answer value={lead.referralSource} /> },
  {
    label: "Call",
    className: "whitespace-nowrap",
    cell: ({ lead, status }) => (
      <>
        <div>{formatDateTime(lead.startTime)}</div>
        <div className="mt-1">
          <CallStatusBadge status={status} />
        </div>
      </>
    ),
  },
  {
    label: "Value",
    className: "whitespace-nowrap tabular-nums",
    cell: ({ lead }) => {
      const value = leadValue(lead);
      if (value == null) return <None />;
      return (
        <span title={lead.dealValue != null ? "Deal value" : "Estimated from their investment range"}>
          {formatMoney(value)}
          {lead.dealValue == null && <span className="text-hint"> est.</span>}
        </span>
      );
    },
  },
  {
    label: "Stage",
    cell: ({ lead }) => <StageSelect compact stage={lead.stage} action={updateStage.bind(null, lead.id)} />,
  },
];

function LeadsTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-max">
        <thead>
          <tr>
            {COLUMNS.map((c, i) => (
              <th key={c.label} className={i === 0 ? STICKY : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lead.id} className="group hover:bg-panel">
              {COLUMNS.map((c) => (
                <td key={c.label} className={c.className}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A form answer, clamped to a few lines; hovering shows the full text. */
function Answer({ value, lines = 2 }: { value: string | null; lines?: 2 | 3 }) {
  if (!value) return <None />;
  return (
    <p className={lines === 3 ? "line-clamp-3" : "line-clamp-2"} title={value}>
      {value}
    </p>
  );
}

function Website({ url }: { url: string | null }) {
  if (!url) return <None />;
  if (!/^https?:\/\//.test(url)) return <span className="block truncate">{url}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="link block truncate"
    >
      {url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
    </a>
  );
}

function EmptyState({ hasLeads }: { hasLeads: boolean }) {
  return (
    <div className="callout">
      <strong>{hasLeads ? "No leads match these filters." : "No leads yet."}</strong>{" "}
      {hasLeads
        ? "Try clearing the search or picking a different tab."
        : "New bookings appear here as soon as Cal.com sends the webhook."}
    </div>
  );
}
