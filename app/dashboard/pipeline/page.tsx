import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { dashboardTimeZone, formatMoneyCompact } from "@/lib/analytics";
import { localDate } from "@/lib/emails/time";
import { formatYmd } from "@/lib/format";
import { listLeads } from "@/lib/leads/store";
import {
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  ORIGINS,
  ORIGIN_LABELS,
  STAGES,
  leadName,
  leadValue,
  type Lead,
} from "@/lib/leads/types";
import { money } from "@/app/dashboard/_components/lead-bits";
import { PipelineBoard, type BoardCard, type BoardColumn } from "./board";

export const metadata: Metadata = { title: "Pipeline · GTM OS" };

/** Whole days from `iso` to `now`. */
const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / 86_400_000);

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function PipelinePage({ searchParams }: PageProps<"/dashboard/pipeline">) {
  return (
    <div className="board-page">
      <Suspense fallback={<BoardSkeleton />}>
        <Pipeline searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function Pipeline({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Days in stage and overdue flags depend on the current time.
  await connection();
  const filters = {
    q: param(sp.q)?.trim() ?? "",
    owner: param(sp.owner) ?? "all",
    origin: param(sp.origin) ?? "all",
    dealType: param(sp.dealType) ?? "all",
    exits: param(sp.exits) === "1",
  };
  const leads = await listLeads();
  const { columns, cards, owners, totals } = buildView(leads, filters);

  const hrefWith = (changes: Partial<Record<keyof typeof filters, string>>) => {
    const next = new URLSearchParams();
    const merged = { ...filters, exits: filters.exits ? "1" : "", ...changes };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") next.set(k, String(v));
    const s = next.toString();
    return s ? `/dashboard/pipeline?${s}` : "/dashboard/pipeline";
  };

  return (
    <>
      <div className="board-bar">
        <div>
          <h1 className="h1">Pipeline</h1>
          <p className="m-0 mt-3 text-muted">
            {cards.filter((c) => c.stage !== "lost" && c.stage !== "nurture").length} open ·{" "}
            <span className="tabular-nums">{totals}</span>
          </p>
        </div>
        <form action="/dashboard/pipeline" className="flex flex-wrap items-center gap-2">
          {filters.exits && <input type="hidden" name="exits" value="1" />}
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search name, company, email…"
            aria-label="Search leads"
            className="input input-sm w-56"
          />
          <select name="owner" defaultValue={filters.owner} aria-label="Owner" className="input input-sm">
            <option value="all">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
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
          <button type="submit" className="action">
            Filter
          </button>
          <Link href={hrefWith({ exits: filters.exits ? "" : "1" })} className="chip" aria-pressed={filters.exits}>
            Show lost / nurture
          </Link>
          <Link href="/dashboard/leads/new" className="btn-primary">
            + Add lead
          </Link>
        </form>
      </div>
      <PipelineBoard columns={columns} cards={cards} showExits={filters.exits} />
    </>
  );
}

/** Kept outside the component because it reads the clock. */
function buildView(
  leads: Lead[],
  filters: { q: string; owner: string; origin: string; dealType: string },
) {
  const now = new Date();
  const today = localDate(now, dashboardTimeZone());
  const q = filters.q.toLowerCase();
  const shown = leads.filter((l) => {
    if (filters.owner !== "all" && (l.owner ?? "") !== filters.owner) return false;
    if (filters.origin !== "all" && l.origin !== filters.origin) return false;
    if (filters.dealType !== "all" && l.dealType !== filters.dealType) return false;
    if (!q) return true;
    return [l.contactName, l.company, l.email, l.domain, l.owner, l.originDetail]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const sum = (list: Lead[], pick: (l: Lead) => number | null) => list.reduce((n, l) => n + (pick(l) ?? 0), 0);
  const totalsFor = (list: Lead[]) => {
    const value = sum(list, leadValue);
    const closed = sum(list, (l) => l.closedPrice);
    if (!value) return "";
    return closed ? `${formatMoneyCompact(value)} · closed ${formatMoneyCompact(closed)}` : `${formatMoneyCompact(value)} est.`;
  };

  const columns: BoardColumn[] = STAGES.map((stage) => ({
    stage,
    totals: totalsFor(shown.filter((l) => l.stage === stage)),
  }));

  const cards: BoardCard[] = shown.map((l) => ({
    id: l.id,
    name: leadName(l),
    company: l.company,
    stage: l.stage,
    value: leadValue(l) != null ? money(l) : null,
    owner: l.owner,
    origin: ORIGIN_LABELS[l.origin],
    audit: l.dealType === "audit",
    nextAction: l.nextAction ?? (l.nextActionDue ? "Next action" : null),
    due: l.nextActionDue ? { label: formatYmd(l.nextActionDue), overdue: l.nextActionDue < today } : null,
    daysInStage: l.stageChangedAt ? daysSince(l.stageChangedAt, now.getTime()) : null,
  }));

  const owners = [...new Set(leads.map((l) => l.owner).filter((o): o is string => Boolean(o)))].sort();
  const open = shown.filter((l) => l.stage !== "lost" && l.stage !== "nurture" && l.stage !== "paid");
  return { columns, cards, owners, totals: totalsFor(open) || "no value yet" };
}

function BoardSkeleton() {
  return (
    <>
      <div className="board-bar">
        <h1 className="h1">Pipeline</h1>
      </div>
      <div className="board" aria-busy="true" aria-label="Loading pipeline">
        {STAGES.map((s) => (
          <div key={s} className="board-col">
            <div className="board-cards">
              <div className="skeleton h-24" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
