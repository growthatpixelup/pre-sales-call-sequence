import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { formatMoney, leadValue } from "@/lib/analytics";
import { callStatus, formatDateTime, type CallStatus } from "@/lib/format";
import { listLeads } from "@/lib/leads/store";
import { LEAD_STAGES, type Lead } from "@/lib/leads/types";
import { updateStage } from "../actions";
import { CallStatusBadge, STAGE_LABELS } from "../_components/badges";
import { ImportButton } from "../_components/import-button";
import { StageSelect } from "../_components/stage-select";

export const metadata: Metadata = { title: "Leads · Dashboard" };

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function LeadsPage({ searchParams }: PageProps<"/dashboard/leads">) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Everyone who booked a call through Cal.com, with their form answers.
          </p>
        </div>
        {process.env.CAL_API_KEY ? <ImportButton /> : null}
      </div>
      <Suspense fallback={<LeadsSkeleton />}>
        <LeadsView searchParams={searchParams} />
      </Suspense>
    </div>
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
    <>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-200/60 p-1 dark:bg-zinc-800/60" aria-label="Call status">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={hrefWith({ status: tab.value })}
              aria-current={status === tab.value ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ${
                status === tab.value
                  ? "bg-white shadow-sm dark:bg-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <form action="/dashboard/leads" className="flex flex-wrap gap-2">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, email, business…"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm sm:w-64 sm:flex-none dark:border-zinc-700 dark:bg-zinc-900"
          />
          <select
            name="stage"
            defaultValue={stage}
            aria-label="Filter by stage"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="all">All stages</option>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Filter
          </button>
        </form>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasLeads={leads.length > 0} />
      ) : (
        <LeadsTable rows={filtered} />
      )}
    </>
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
    { label: "Total leads", value: leads.length },
    { label: "Upcoming calls", value: withStatus.filter((l) => l.status === "upcoming").length },
    { label: "Booked in last 7 days", value: leads.filter((l) => Date.parse(l.bookedAt) > weekAgo).length },
    { label: "Won", value: leads.filter((l) => l.stage === "won").length },
  ];

  return { filtered, stats };
}

const TH = "whitespace-nowrap px-4 py-3";
const TD = "px-4 py-3 align-top text-zinc-700 dark:text-zinc-300";
// The pinned name column needs its own background so scrolled cells don't show through.
const STICKY = "sticky left-0 z-10 shadow-[1px_0_0_0] shadow-zinc-200 dark:shadow-zinc-800";
const STICKY_BODY = `${STICKY} bg-white group-hover:bg-zinc-50 dark:bg-zinc-900 dark:group-hover:bg-zinc-800`;
const STICKY_HEAD = `${STICKY} bg-zinc-50 dark:bg-zinc-900`;

type Row = { lead: Lead; status: CallStatus };

/** Table columns: every Cal.com form answer, in the order the form asks them, then the call. */
const COLUMNS: { label: string; cell: (row: Row) => ReactNode; className?: string }[] = [
  {
    label: "Name",
    className: `${STICKY_BODY} whitespace-nowrap`,
    cell: ({ lead }) => (
      <Link
        href={`/dashboard/leads/${lead.id}`}
        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
      >
        {lead.name}
      </Link>
    ),
  },
  {
    label: "Email",
    className: "whitespace-nowrap",
    cell: ({ lead }) => (
      <a href={`mailto:${lead.email}`} className="hover:underline">
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
      if (value == null) return <Empty />;
      return (
        <span title={lead.dealValue != null ? "Deal value" : "Estimated from their investment range"}>
          {formatMoney(value)}
          {lead.dealValue == null && <span className="text-zinc-400 dark:text-zinc-500"> est.</span>}
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
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              {COLUMNS.map((c, i) => (
                <th key={c.label} className={`${TH} ${i === 0 ? STICKY_HEAD : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((row) => (
              <tr key={row.lead.id} className="group hover:bg-zinc-50 dark:hover:bg-zinc-800">
                {COLUMNS.map((c) => (
                  <td key={c.label} className={`${TD} ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A form answer, clamped to a few lines; hovering shows the full text. */
function Answer({ value, lines = 2 }: { value: string | null; lines?: 2 | 3 }) {
  if (!value) return <Empty />;
  return (
    <p className={lines === 3 ? "line-clamp-3" : "line-clamp-2"} title={value}>
      {value}
    </p>
  );
}

function Website({ url }: { url: string | null }) {
  if (!url) return <Empty />;
  if (!/^https?:\/\//.test(url)) return <span className="block truncate">{url}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="block truncate text-blue-600 hover:underline dark:text-blue-400"
    >
      {url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
    </a>
  );
}

function Empty() {
  return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
}

function EmptyState({ hasLeads }: { hasLeads: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-medium">{hasLeads ? "No leads match these filters" : "No leads yet"}</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {hasLeads
          ? "Try clearing the search or picking a different tab."
          : "New bookings appear here as soon as Cal.com sends the webhook."}
      </p>
    </div>
  );
}

function LeadsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading leads">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
    </div>
  );
}
