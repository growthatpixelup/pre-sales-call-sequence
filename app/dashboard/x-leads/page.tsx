import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { formatDate, formatDateTime, humaniseEvent } from "@/lib/format";
import { listLeads, recentActivityByOrigin } from "@/lib/leads/store";
import { ACTIVITY_LABELS, STAGES, STAGE_LABELS, leadName, type LeadActivity } from "@/lib/leads/types";
import {
  X_SOURCES,
  X_SOURCE_LABELS,
  filterXLeads,
  summariseXLeads,
  toXLeads,
  xAvatarUrl,
  type XLead,
  type XLeadFilters,
} from "@/lib/leads/x-leads";
import { StageBadge } from "@/app/dashboard/_components/badges";
import { Empty, Icon, None, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "@/app/dashboard/_components/ui";

export const metadata: Metadata = { title: "X leads · GTM OS" };

const TITLE = "X leads";
const SUB = "People found by social listening on X (Lead Radar and the DM pipeline). Warm targets: nobody has contacted them unless their activity says so.";

/** How many recent activity entries a row shows when opened. */
const ACTIVITY_PER_LEAD = 5;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function XLeadsPage({ searchParams }: PageProps<"/dashboard/x-leads">) {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading X leads" />}>
      <XLeads searchParams={searchParams} />
    </Suspense>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function XLeads({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // "Added in the last 7 days" depends on the current time.
  await connection();
  const filters: XLeadFilters = {
    q: param(sp.q)?.trim() ?? "",
    source: param(sp.source) ?? "all",
    stage: param(sp.stage) ?? "all",
  };

  const [leads, activity] = await Promise.all([listLeads(), recentActivityByOrigin("x_outreach", ACTIVITY_PER_LEAD)]);
  const all = toXLeads(leads);
  const shown = filterXLeads(all, filters);
  const summary = summarise(all);
  const filtered = filters.q !== "" || filters.source !== "all" || filters.stage !== "all";

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Total X leads", <Count key="total" n={summary.total} />],
              ["Added last 7 days", <Count key="week" n={summary.lastWeek} />],
              ...summary.byStage.map(
                ({ stage, count }) => [STAGE_LABELS[stage], <Count key={stage} n={count} />] as [string, ReactNode],
              ),
            ]}
          />
          <RailActions>
            <Link href="/dashboard/pipeline?origin=x_outreach" className="btn">
              X leads on the pipeline
              <Icon name="next" />
            </Link>
          </RailActions>
        </>
      }
    >
      <Section
        wide
        label={`${shown.length} ${shown.length === 1 ? "lead" : "leads"}${filtered ? ` of ${all.length}` : ""}`}
        aside={
          <form action="/dashboard/x-leads" className="flex flex-wrap gap-2">
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Search name, company, @handle…"
              aria-label="Search X leads"
              className="input input-sm min-w-0 flex-1 sm:w-64 sm:flex-none"
            />
            <select name="source" defaultValue={filters.source} aria-label="Source" className="input input-sm">
              <option value="all">All sources</option>
              {X_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {X_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <select name="stage" defaultValue={filters.stage} aria-label="Stage" className="input input-sm">
              <option value="all">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
            <button type="submit" className="action">
              Filter
            </button>
            {filtered && (
              <Link href="/dashboard/x-leads" className="action">
                Clear
              </Link>
            )}
          </form>
        }
      >
        {shown.length ? <XLeadsTable rows={shown} activity={activity} /> : <EmptyState hasLeads={all.length > 0} />}
      </Section>
    </Page>
  );
}

/** Kept outside the component because it reads the clock. */
function summarise(rows: XLead[]) {
  return summariseXLeads(rows, Date.now());
}

const COLUMNS = ["Name", "Company", "X handle", "Source", "Stage", "Last touch", "Added"];
// Chevron, then the seven columns.
const GRID = "grid grid-cols-[20px_minmax(160px,1.4fr)_minmax(120px,1fr)_minmax(170px,1fr)_110px_120px_150px_110px] gap-x-4";

/**
 * One row per lead. Rows are <details> so each opens to its recent activity without client
 * JavaScript; the grid keeps the columns lined up like a table.
 */
function XLeadsTable({ rows, activity }: { rows: XLead[]; activity: Map<string, LeadActivity[]> }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px] text-[0.92rem]">
        <div className={`${GRID} border-b border-line py-3 font-mono text-[0.74rem] uppercase tracking-[0.07em] text-muted`}>
          <span aria-hidden />
          {COLUMNS.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        {rows.map((row) => (
          <XLeadRow key={row.lead.id} row={row} activity={activity.get(row.lead.id) ?? []} />
        ))}
      </div>
    </div>
  );
}

function XLeadRow({ row, activity }: { row: XLead; activity: LeadActivity[] }) {
  const { lead, source, handle } = row;
  return (
    <details className="group border-b border-line">
      <summary
        className={`${GRID} cursor-pointer list-none items-center py-3 text-body hover:bg-panel`}
        aria-label={`${leadName(lead)}: show recent activity`}
      >
        <span aria-hidden className="pt-0.5 text-hint transition-transform group-open:rotate-90">
          <Icon name="next" />
        </span>
        <span className="min-w-0">
          <Link href={`/dashboard/leads/${lead.id}`} className="link font-medium no-underline hover:underline">
            {leadName(lead)}
          </Link>
        </span>
        <span className="min-w-0 truncate" title={lead.company ?? undefined}>
          {lead.company ?? <None />}
        </span>
        <span className="min-w-0">
          {handle ? (
            <a
              href={`https://x.com/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link flex min-w-0 items-center gap-2"
            >
              {/* A plain img: a remote avatar at 24px gains nothing from the image optimiser. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={xAvatarUrl(handle)}
                alt=""
                width={24}
                height={24}
                loading="lazy"
                // `!`: globals.css squares every corner (`* { border-radius: 0 }`) outside any layer.
                className="size-6 shrink-0 rounded-full! bg-panel-2 object-cover"
              />
              <span className="truncate">@{handle}</span>
            </a>
          ) : (
            <span title={lead.originDetail ?? undefined}>
              <None />
            </span>
          )}
        </span>
        <span>{source ? X_SOURCE_LABELS[source] : <None />}</span>
        <span>
          <StageBadge stage={lead.stage} />
        </span>
        <span className="whitespace-nowrap">{lead.lastTouchAt ? formatDateTime(lead.lastTouchAt) : <None />}</span>
        <span className="whitespace-nowrap">{formatDate(lead.createdAt)}</span>
      </summary>
      <div className="pb-5 pl-9">
        <p className="mono-label m-0 mb-3">Recent activity</p>
        {activity.length ? (
          <ol className="steps max-w-[80ch]">
            {activity.map((a) => (
              <li key={a.id}>
                <div>
                  <div className="font-medium">{ACTIVITY_LABELS[a.type] ?? humaniseEvent(a.type)}</div>
                  {a.detail && <div className="whitespace-pre-line text-[0.92rem] text-body">{a.detail}</div>}
                  <div className="mono-label mt-1">{formatDateTime(a.at)}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No activity logged yet.</Empty>
        )}
        <Link href={`/dashboard/leads/${lead.id}`} className="action mt-3">
          Open lead
          <Icon name="next" />
        </Link>
      </div>
    </details>
  );
}

function EmptyState({ hasLeads }: { hasLeads: boolean }) {
  return (
    <div className="callout">
      <strong>{hasLeads ? "No X leads match these filters." : "No X leads yet."}</strong>{" "}
      {hasLeads
        ? "Try clearing the search or picking a different source or stage."
        : "Leads the bot finds on X (origin X outreach) show up here once they're loaded."}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className={`tabular-nums ${n ? "" : "text-hint"}`}>{n}</span>;
}
