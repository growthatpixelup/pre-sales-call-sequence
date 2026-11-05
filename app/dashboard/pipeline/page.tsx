import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { dashboardTimeZone, formatMoneyCompact } from "@/lib/analytics";
import { listBookings } from "@/lib/bookings/store";
import { localDate } from "@/lib/emails/time";
import { formatDateTime, formatYmd } from "@/lib/format";
import {
  DEFAULT_PIPELINE_PERIOD,
  PIPELINE_PERIODS,
  buildPipeline,
  enrichLeads,
  inPeriod,
  type PipelineLead,
  type PipelinePeriod,
  type PipelineView,
} from "@/lib/leads/pipeline";
import { listLeads } from "@/lib/leads/store";
import { DEAL_TYPES, DEAL_TYPE_LABELS, ORIGINS, ORIGIN_LABELS, STAGES, STAGE_LABELS, leadName, type Stage } from "@/lib/leads/types";
import { updateLeadStage } from "@/app/dashboard/leads/actions";
import { StageSelect } from "@/app/dashboard/_components/stage-select";
import { BarChart } from "@/app/dashboard/content/_components/bar-chart";
import { ChipGroup, ContentSection, EmptyNotice, StatGrid, hrefBuilder } from "@/app/dashboard/content/_components/kit";
import { PipelineBoard, type BoardCard, type BoardColumn } from "./board";

export const metadata: Metadata = { title: "Pipeline · GTM OS" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** Cards per board column; older ones are counted, not drawn. */
const COLUMN_CARDS = 40;
/** Rows in "Needs an outcome" before "Show all". */
const OUTCOME_ROWS = 15;

export default function PipelinePage({ searchParams }: PageProps<"/dashboard/pipeline">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<Skeleton />}>
        <Pipeline searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

async function Pipeline({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Upcoming vs past calls and "last N days" depend on the current time.
  await connection();
  const p = param(sp.period);
  const filters = {
    period: (PIPELINE_PERIODS.some((x) => x.value === p) ? p : DEFAULT_PIPELINE_PERIOD) as PipelinePeriod,
    q: param(sp.q)?.trim() ?? "",
    origin: param(sp.origin) ?? "all",
    dealType: param(sp.dealType) ?? "all",
    owner: param(sp.owner) ?? "all",
    exits: param(sp.exits) === "1" ? "1" : "",
    outcomes: param(sp.outcomes) === "all" ? "all" : "",
  };
  const [leads, bookings] = await Promise.all([listLeads(), listBookings()]);
  const { view, shown, board, owners } = load(leads, bookings, filters);
  const href = hrefBuilder("/dashboard/pipeline", filters, { period: DEFAULT_PIPELINE_PERIOD, q: "", origin: "all", dealType: "all", owner: "all", exits: "", outcomes: "" });
  const periodLabel = PIPELINE_PERIODS.find((x) => x.value === filters.period)!.label.toLowerCase();
  const scope = filters.period === "all" ? "all time" : `created in the last ${periodLabel}`;

  return (
    <>
      <header className="border-b border-line px-4 pt-8 pb-6 sm:px-[30px]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="h1 m-0">Pipeline</h1>
            <p className="m-0 mt-3 max-w-[62ch] text-muted">
              Every deal from first reply to paid: where they stand, what&apos;s worth what, and which calls still need an outcome.
            </p>
          </div>
          <Link href="/dashboard/leads/new" className="btn-primary w-auto">
            + Add lead
          </Link>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <ChipGroup
            label="Leads"
            options={PIPELINE_PERIODS.map((x) => ({ label: x.label, href: href({ period: x.value }), active: filters.period === x.value }))}
          />
          <form action="/dashboard/pipeline" className="flex flex-wrap items-center gap-2">
            {filters.period !== DEFAULT_PIPELINE_PERIOD && <input type="hidden" name="period" value={filters.period} />}
            {filters.exits && <input type="hidden" name="exits" value="1" />}
            <input type="search" name="q" defaultValue={filters.q} placeholder="Search name, company, email…" aria-label="Search leads" className="input input-sm w-56" />
            <select name="origin" defaultValue={filters.origin} aria-label="Source" className="input input-sm">
              <option value="all">All sources</option>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABELS[o]}
                </option>
              ))}
            </select>
            <select name="dealType" defaultValue={filters.dealType} aria-label="Deal type" className="input input-sm">
              <option value="all">All deal types</option>
              {DEAL_TYPES.map((d) => (
                <option key={d} value={d}>
                  {DEAL_TYPE_LABELS[d]}
                </option>
              ))}
            </select>
            {owners.length > 0 && (
              <select name="owner" defaultValue={filters.owner} aria-label="Owner" className="input input-sm">
                <option value="all">All owners</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="action">
              Filter
            </button>
          </form>
        </div>
      </header>

      {view.total === 0 ? (
        <ContentSection label="Pipeline">
          <EmptyNotice title="No leads match.">Try a longer period or clear the filters.</EmptyNotice>
        </ContentSection>
      ) : (
        <>
          <ContentSection label="At a glance" explain={`${view.total} leads ${scope}. Values use the closed price, else the estimate, else the middle of the investment range they gave when booking.`}>
            <StatGrid
              stats={[
                { label: "Leads", value: String(view.total), sub: `${view.open.count} still open` },
                { label: "Calls booked", value: String(view.callsBooked), sub: `${view.upcoming.length} upcoming` },
                { label: "Won", value: formatMoneyCompact(view.won.revenue), sub: `${view.won.count} deals · ${formatMoneyCompact(view.paid)} paid` },
                {
                  label: "Open pipeline",
                  value: formatMoneyCompact(view.open.value),
                  sub: view.open.ranged ? `${view.open.ranged} valued from their investment range` : "From prices and estimates",
                },
                { label: "Call → won", value: pct(view.callToWin), sub: "Won ÷ calls booked" },
                { label: "Win rate", value: pct(view.winRate), sub: `Won ÷ (won + lost) · ${view.lost} lost` },
                { label: "Needs an outcome", value: String(view.needsOutcome.length), sub: "Call happened, stage not updated" },
                { label: "Cancelled calls", value: String(view.cancelled.length), sub: "Still at Call booked" },
              ]}
            />
          </ContentSection>

          <ContentSection
            label="Funnel"
            explain="How many leads reached each stage (at it or further on), how many are sitting there now, and the share that made it to the next stage."
          >
            <Funnel view={view} />
          </ContentSection>

          <ContentSection
            label={`Needs an outcome · ${view.needsOutcome.length}`}
            explain="Their call is in the past but the lead still says Call booked. Set what happened: Call held, No-show, or move it on. Lost needs a reason, so set it on the lead page."
          >
            {view.needsOutcome.length ? (
              <>
                <OutcomeTable rows={filters.outcomes === "all" ? view.needsOutcome : view.needsOutcome.slice(0, OUTCOME_ROWS)} />
                {view.needsOutcome.length > OUTCOME_ROWS && (
                  <Link href={href({ outcomes: filters.outcomes === "all" ? "" : "all" })} className="action mt-4" scroll={false}>
                    {filters.outcomes === "all" ? "Show fewer" : `Show all ${view.needsOutcome.length}`}
                  </Link>
                )}
              </>
            ) : (
              <EmptyNotice title="All caught up.">Every past call has an outcome.</EmptyNotice>
            )}
          </ContentSection>

          {view.upcoming.length > 0 && (
            <ContentSection label={`Upcoming calls · ${view.upcoming.length}`}>
              <ul className="list">
                {view.upcoming.map((p) => (
                  <li key={p.lead.id}>
                    <div className="item">
                      <div className="min-w-0">
                        <p className="mono-label m-0">{formatDateTime(p.call!.at)}</p>
                        <Link href={`/dashboard/leads/${p.lead.id}`} className="item-title mt-2 inline-block">
                          {leadName(p.lead)}
                        </Link>
                        <p className="m-0 mt-1 text-[0.92rem] text-muted">
                          {[p.lead.company, ORIGIN_LABELS[p.lead.origin], p.value != null ? valueText(p) : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </ContentSection>
          )}

          <ContentSection label="By source" explain="Which channels bring leads that book, show up and pay.">
            <div className="overflow-x-auto">
              <table className="table min-w-max">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Held+</th>
                    <th className="text-right">Won</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Open value</th>
                    <th className="text-right">Lead → won</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {view.bySource.map((r) => (
                    <tr key={r.origin}>
                      <td>
                        <Link href={href({ origin: r.origin })} className="link" scroll={false}>
                          {ORIGIN_LABELS[r.origin]}
                        </Link>
                      </td>
                      <td className="text-right">{r.leads}</td>
                      <td className="text-right">{r.calls}</td>
                      <td className="text-right">{r.held}</td>
                      <td className="text-right">{r.won}</td>
                      <td className="text-right">{r.revenue ? formatMoneyCompact(r.revenue) : "—"}</td>
                      <td className="text-right">{r.openValue ? formatMoneyCompact(r.openValue) : "—"}</td>
                      <td className="text-right">{pct(r.leads ? r.won / r.leads : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ContentSection>

          <ContentSection label="New leads per month" explain="Leads created each month over the last 12 months (this ignores the period filter; source and deal type still apply).">
            <BarChart
              points={view.months.map((m) => ({ label: m.label, values: [m.leads] }))}
              series={[{ label: "New leads", colorClass: "bg-blue" }]}
              measure="New leads"
              firstColumn="Month"
            />
          </ContentSection>
        </>
      )}

      <section className="border-b border-line">
        <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-8 sm:px-[30px]">
          <div>
            <h2 className="mono-label m-0">Board · {shown.length} leads</h2>
            <p className="m-0 mt-2 max-w-[70ch] text-[0.9rem] text-muted">
              Drag a card to move its stage. Leads {scope}; each column shows the {COLUMN_CARDS} most recent.
            </p>
          </div>
          <Link href={href({ exits: filters.exits ? "" : "1" })} className="chip" aria-pressed={Boolean(filters.exits)} scroll={false}>
            Show lost / nurture
          </Link>
        </div>
        <div className="board-page">
          <PipelineBoard columns={board.columns} cards={board.cards} showExits={Boolean(filters.exits)} />
        </div>
      </section>
    </>
  );
}

/** Kept outside the component because it reads the clock. */
function load(leads: Awaited<ReturnType<typeof listLeads>>, bookings: Awaited<ReturnType<typeof listBookings>>, f: { period: PipelinePeriod; q: string; origin: string; dealType: string; owner: string }) {
  const nowMs = Date.now();
  const q = f.q.toLowerCase();
  const all = enrichLeads(leads, bookings, nowMs);
  const filtered = all.filter((p) => {
    const l = p.lead;
    if (f.origin !== "all" && l.origin !== f.origin) return false;
    if (f.dealType !== "all" && l.dealType !== f.dealType) return false;
    if (f.owner !== "all" && (l.owner ?? "") !== f.owner) return false;
    if (!q) return true;
    return [l.contactName, l.company, l.email, l.domain, l.owner, l.originDetail].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const shown = filtered.filter((p) => inPeriod(p, f.period, nowMs));
  const view = buildPipeline(shown, nowMs);
  // The month chart always spans 12 months, whatever the period.
  view.months = buildPipeline(filtered, nowMs).months;
  return { view, shown, board: buildBoard(shown, nowMs), owners: [...new Set(leads.map((l) => l.owner).filter((o): o is string => Boolean(o)))].sort() };
}

function valueText(p: PipelineLead) {
  if (p.value == null) return "—";
  return `${formatMoneyCompact(p.value)}${p.valueKind === "closed" ? "" : p.valueKind === "range" ? " range" : " est."}`;
}

const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / 86_400_000);

function buildBoard(shown: PipelineLead[], nowMs: number): { columns: BoardColumn[]; cards: BoardCard[] } {
  const today = localDate(new Date(nowMs), dashboardTimeZone());
  const columns: BoardColumn[] = [];
  const cards: BoardCard[] = [];
  for (const stage of STAGES) {
    const here = shown.filter((p) => p.lead.stage === stage).sort((a, b) => Date.parse(b.lead.updatedAt) - Date.parse(a.lead.updatedAt));
    const value = here.reduce((n, p) => n + (p.value ?? 0), 0);
    columns.push({ stage, totals: value ? formatMoneyCompact(value) : "", more: Math.max(0, here.length - COLUMN_CARDS) });
    for (const p of here.slice(0, COLUMN_CARDS)) {
      const l = p.lead;
      cards.push({
        id: l.id,
        name: leadName(l),
        company: l.company,
        stage: l.stage,
        value: p.value != null ? valueText(p) : null,
        owner: l.owner,
        origin: ORIGIN_LABELS[l.origin],
        audit: l.dealType === "audit",
        nextAction:
          l.nextAction ??
          (stage === "call_booked" && p.call?.state === "done"
            ? "Set the call's outcome"
            : stage === "call_booked" && p.call?.state === "upcoming"
              ? `Call ${formatDateTime(p.call.at)}`
              : null),
        due: l.nextActionDue ? { label: formatYmd(l.nextActionDue), overdue: l.nextActionDue < today } : null,
        daysInStage: l.stageChangedAt ? daysSince(l.stageChangedAt, nowMs) : null,
      });
    }
  }
  return { columns, cards };
}

function Funnel({ view }: { view: PipelineView }) {
  const max = Math.max(1, ...view.funnel.map((s) => s.reached));
  return (
    <div className="grid gap-px">
      <div className="hidden grid-cols-[150px_1fr_90px_90px_90px] gap-4 pb-2 font-mono text-[0.72rem] tracking-[0.07em] text-muted uppercase md:grid">
        <span>Stage</span>
        <span>Reached</span>
        <span className="text-right">Now here</span>
        <span className="text-right">Value here</span>
        <span className="text-right">→ Next</span>
      </div>
      {view.funnel.map((s, i) => {
        const next = view.conversions[i];
        return (
          <div key={s.stage} className="grid grid-cols-[110px_1fr] items-center gap-x-4 gap-y-1 border-t border-line py-3 md:grid-cols-[150px_1fr_90px_90px_90px]">
            <span className="text-text">{STAGE_LABELS[s.stage]}</span>
            <span className="flex items-center gap-3">
              <span className="h-3 bg-blue" style={{ width: `${Math.max(s.reached ? 0.5 : 0, (s.reached / max) * 100)}%` }} aria-hidden />
              <span className="font-mono text-[0.85rem] tabular-nums">{s.reached}</span>
            </span>
            <span className="col-start-2 text-[0.88rem] text-muted tabular-nums md:col-start-auto md:text-right md:text-body">
              <span className="md:hidden">Now here: </span>
              {s.count}
            </span>
            <span className="col-start-2 text-[0.88rem] text-muted tabular-nums md:col-start-auto md:text-right md:text-body">
              <span className="md:hidden">Value: </span>
              {s.value ? formatMoneyCompact(s.value) : "—"}
            </span>
            <span className="col-start-2 text-[0.88rem] text-muted tabular-nums md:col-start-auto md:text-right">
              {next ? (
                <>
                  <span className="md:hidden">To {STAGE_LABELS[next.to]}: </span>
                  {pct(next.rate)}
                </>
              ) : null}
            </span>
          </div>
        );
      })}
      <p className="m-0 border-t border-line pt-3 text-[0.85rem] text-muted">
        Off the path: {view.noShow} no-show · {view.lost} lost · {view.nurture} nurture.
        {view.needsOutcome.length > 0 && (
          <>
            {" "}
            <span className="text-text">
              Call booked → Call held reads low while {view.needsOutcome.length} past calls have no outcome set (below).
            </span>
          </>
        )}
      </p>
    </div>
  );
}

function OutcomeTable({ rows }: { rows: PipelineLead[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-max">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Call was</th>
            <th>Source</th>
            <th className="text-right">Value</th>
            <th>Set stage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.lead.id}>
              <td>
                <Link href={`/dashboard/leads/${p.lead.id}`} className="link font-medium no-underline hover:underline">
                  {leadName(p.lead)}
                </Link>
                {p.lead.company && p.lead.company !== leadName(p.lead) && <div className="text-[0.85rem] text-muted">{p.lead.company}</div>}
              </td>
              <td className="whitespace-nowrap">{formatDateTime(p.call!.at)}</td>
              <td>{ORIGIN_LABELS[p.lead.origin]}</td>
              <td className="text-right tabular-nums">{valueText(p)}</td>
              <td>
                <StageSelect compact stage={p.lead.stage as Stage} action={updateLeadStage.bind(null, p.lead.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-px px-4 py-8 sm:px-[30px]" aria-busy="true" aria-label="Loading pipeline">
      <div className="skeleton h-24" />
      <div className="skeleton h-40" />
      <div className="skeleton h-72" />
    </div>
  );
}
