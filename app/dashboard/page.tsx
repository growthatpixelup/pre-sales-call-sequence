import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import {
  buildAnalytics,
  formatMoney,
  formatMoneyCompact,
  formatRange,
  pipelineSnapshot,
  resolveRange,
  type AttributionRow,
  type PeriodStats,
} from "@/lib/analytics";
import { listOpenDrafts } from "@/lib/emails/queue";
import { listReplies, unreadReplyCount } from "@/lib/emails/replies";
import { formatDateTime } from "@/lib/format";
import { listLeads, rescheduleCounts } from "@/lib/leads/store";
import type { Lead } from "@/lib/leads/types";
import { STAGE_LABELS } from "./_components/badges";
import { BookingsChart } from "./_components/bookings-chart";
import { RangeFilter } from "./_components/range-filter";
import { SourceDonut } from "./_components/source-donut";
import { SyncButton } from "./_components/sync-button";
import { ReplyList } from "./_components/replies";
import { Empty, Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section } from "./_components/ui";

export const metadata: Metadata = { title: "Overview · Dashboard" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function OverviewPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading overview" />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

const TITLE = "Overview";
const SUB = "Your call pipeline from Cal.com, and what needs you today.";

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Everything here depends on the current time.
  await connection();
  const [leads, drafts, replies, unread, reschedules] = await Promise.all([
    listLeads(),
    listOpenDrafts(),
    // Replies need migration 005; the overview still works without it.
    listReplies({ unreadOnly: true, limit: 5 }).catch(() => []),
    unreadReplyCount().catch(() => 0),
    rescheduleCounts(),
  ]);
  const view = buildView(leads, reschedules, {
    range: param(sp.range),
    from: param(sp.from),
    to: param(sp.to),
    compare: param(sp.compare),
  });
  const { range, stats, snapshot } = view;
  const leadsById = new Map(leads.map((l) => [l.id, l]));
  const leadNames = new Map(leads.map((l) => [l.id, l.name]));
  const compareLabel = range.compare === "year" ? "same period last year" : "previous period";
  const nextDraft = drafts[0];

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          {/* Right now: not affected by the date range */}
          <Rows
            rows={[
              [
                "Upcoming",
                <RailStat
                  key="upcoming"
                  value={String(snapshot.upcoming.length)}
                  note={`${snapshot.upcomingThisWeek} in the next 7 days${
                    snapshot.pendingConfirmation ? ` · ${snapshot.pendingConfirmation} awaiting confirmation` : ""
                  }`}
                />,
              ],
              ["Open", <RailStat key="open" value={String(snapshot.open)} note="Leads not yet won, lost or closed" />],
              [
                "Value",
                <RailStat
                  key="value"
                  value={formatMoneyCompact(snapshot.openValue)}
                  note={
                    snapshot.unpriced
                      ? `${snapshot.unpriced} open lead${snapshot.unpriced === 1 ? "" : "s"} without a value`
                      : "Deal value, or the middle of their investment range"
                  }
                />,
              ],
              [
                "Replies",
                <RailStat
                  key="replies"
                  value={`${unread} unread`}
                  note={drafts.length ? `${drafts.length} Email 1 draft${drafts.length === 1 ? "" : "s"} to send` : "No Email 1 drafts waiting"}
                />,
              ],
            ]}
          />
          <RailActions>
            {nextDraft ? (
              <Link href={`/dashboard/leads/${nextDraft.leadId}/emails/case_study`} className="btn-primary">
                Send next Email 1
                <Icon name="send" />
              </Link>
            ) : (
              <Link href="/dashboard/leads?status=upcoming" className="btn-primary">
                Upcoming calls
                <Icon name="next" />
              </Link>
            )}
            <Link href="/dashboard/leads" className="btn">
              All leads
              <Icon name="next" />
            </Link>
            {process.env.CAL_API_KEY ? <SyncButton /> : null}
          </RailActions>
        </>
      }
    >
      {/* Follows the date range */}
      <Section
        label="Period"
        aside={
          <p className="m-0 text-[0.85rem] text-muted">
            {formatRange(range.current)}
            {range.previous && <> · vs {formatRange(range.previous)}</>}
          </p>
        }
      >
        <RangeFilter
          key={`${range.preset}-${range.current.from}-${range.current.to}-${range.compare}`}
          preset={range.preset}
          compare={range.compare}
          from={range.current.from}
          to={range.current.to}
        />
        <dl className="stats mt-6">
          <Tile
            label="Calls booked"
            value={String(stats.current.booked)}
            delta={delta(stats, "booked", compareLabel)}
            note={bookedNote(stats.current)}
          />
          <Tile label="Calls completed" value={String(stats.current.completed)} delta={delta(stats, "completed", compareLabel)} />
          <Tile
            label="Budget booked"
            value={formatMoneyCompact(stats.current.budget)}
            delta={delta(stats, "budget", compareLabel, formatMoneyCompact)}
            note={stats.current.unpriced ? `${stats.current.unpriced} without a budget` : undefined}
          />
          <Tile
            label="Deals won"
            value={String(stats.current.won)}
            delta={delta(stats, "won", compareLabel)}
            note={stats.current.won ? `${formatMoney(stats.current.wonValue)} won` : undefined}
          />
        </dl>
      </Section>

      <Section label="Calls booked over time">
        <BookingsChart buckets={stats.series.buckets} unit={stats.series.unit} />
      </Section>

      <Section label="How they found us" aside={<p className="hint m-0">Calls booked in this period, by their answer to “How did you find us?”</p>}>
        <AttributionTable rows={stats.attribution} />
      </Section>

      <Section
        label="Where those leads are now"
        aside={
          <p className="m-0">
            <span className="mono-label">Win rate </span>
            <span className="font-display text-lg font-medium">
              {stats.winRate == null ? "—" : `${Math.round(stats.winRate * 100)}%`}
            </span>
          </p>
        }
      >
        <StageTable stages={stats.stages} />
      </Section>

      {/* Right now: not affected by the date range */}
      <Section label="Next calls" aside={<SectionLink href="/dashboard/leads?status=upcoming">All upcoming</SectionLink>}>
        {snapshot.upcoming.length ? (
          <ul className="list">
            {snapshot.upcoming.slice(0, 5).map((lead) => (
              <li key={lead.id}>
                <div className="item">
                  <div className="min-w-0">
                    <Link href={`/dashboard/leads/${lead.id}`} className="item-title">
                      {lead.name}
                    </Link>
                    <p className="m-0 mt-1 text-[0.92rem] text-muted">
                      {formatDateTime(lead.startTime)}
                      {lead.businessName ? ` · ${lead.businessName}` : ""}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No upcoming calls.</Empty>
        )}
      </Section>

      <Section label="Email 1 to personalise">
        {drafts.length ? (
          <ul className="list">
            {drafts.slice(0, 5).map((d, i) => {
              const lead = leadsById.get(d.leadId);
              return (
                <li key={d.id} className={i === 0 ? "item-picked" : undefined}>
                  <div className="item">
                    <div className="min-w-0">
                      <p className="item-title m-0 truncate">{lead?.name ?? "Unknown lead"}</p>
                      <p className="m-0 mt-1 text-[0.92rem] text-muted">
                        {d.dueAt ? `Best sent around ${formatDateTime(d.dueAt)}` : "Ready to send"}
                      </p>
                    </div>
                    <div className="item-actions">
                      <Link href={`/dashboard/leads/${d.leadId}/emails/case_study`} className="action">
                        Personalise &amp; send
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nothing to send. New bookings add a draft here.</Empty>
        )}
      </Section>

      <Section label="Unread replies" aside={<SectionLink href="/dashboard/replies">All replies</SectionLink>}>
        {replies.length ? <ReplyList replies={replies} leadNames={leadNames} preview /> : <Empty>No unread replies.</Empty>}
      </Section>

    </Page>
  );
}

function bookedNote({ cancelled, rescheduled }: PeriodStats) {
  const parts = [
    cancelled ? `${cancelled} cancelled` : null,
    rescheduled ? `${rescheduled} rescheduled (counted once)` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function AttributionTable({ rows }: { rows: AttributionRow[] }) {
  const total = rows.reduce((n, r) => n + r.booked, 0);
  if (!total) return <Empty>No calls booked in this period.</Empty>;
  const max = Math.max(...rows.map((r) => r.booked));
  return (
    <>
      <SourceDonut rows={rows} />
      <details className="mt-6">
        <summary className="mono-label cursor-pointer hover:text-text">Details</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead>
              <tr>
                <th>Channel</th>
                <th className="w-[30%]">
                  <span className="sr-only">Share</span>
                </th>
                <th className="text-right">Booked</th>
                <th className="text-right">Going ahead</th>
                <th className="text-right">Won</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            {rows
              .filter((r) => r.booked > 0)
              .map((r) => (
                <tbody key={r.pillar}>
                  <tr>
                    <td className="whitespace-nowrap font-medium text-text">{r.pillar}</td>
                    <td className="align-middle">
                      <div className="flex items-center gap-2">
                        <div className="h-2 bg-blue" style={{ width: `${(r.booked / max) * 100}%` }} aria-hidden />
                        <span className="font-mono text-[0.72rem] text-muted">{Math.round((r.booked / total) * 100)}%</span>
                      </div>
                    </td>
                    <td className="text-right tabular-nums text-text">{r.booked}</td>
                    <td className="text-right tabular-nums">{r.live}</td>
                    <td className="text-right tabular-nums">{r.won || "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{r.value ? formatMoneyCompact(r.value) : "—"}</td>
                  </tr>
                  {r.sources.length > 1 &&
                    r.sources.map((src) => (
                      <tr key={src.source} className="text-[0.85rem]">
                        <td className="whitespace-nowrap pl-4 text-muted">{src.source}</td>
                        <td />
                        <td className="text-right tabular-nums text-muted">{src.booked}</td>
                        <td className="text-right tabular-nums text-muted">{src.live}</td>
                        <td />
                        <td />
                      </tr>
                    ))}
                </tbody>
              ))}
          </table>
        </div>
      </details>
    </>
  );
}

function RailStat({ value, note }: { value: string; note: string }) {
  return (
    <>
      <span className="block font-display text-xl font-medium tracking-[-0.02em] tabular-nums">{value}</span>
      <span className="block text-[0.85rem] text-muted">{note}</span>
    </>
  );
}

/** Kept outside the component because it reads the clock. */
function buildView(leads: Lead[], reschedules: Map<string, number>, params: Parameters<typeof resolveRange>[0]) {
  const now = new Date();
  const earliest = leads.reduce<string | null>((min, l) => (!min || l.bookedAt < min ? l.bookedAt : min), null);
  const range = resolveRange(params, now, earliest);
  return {
    range,
    stats: buildAnalytics(leads, range, now.getTime(), reschedules),
    snapshot: pipelineSnapshot(leads, now.getTime()),
  };
}

type Stats = ReturnType<typeof buildAnalytics>;

/** "+3 (+25%) vs previous period". */
function delta(
  stats: Stats,
  key: keyof PeriodStats,
  label: string,
  format: (n: number) => string = String,
): { text: string; direction: "up" | "down" | "flat" } | undefined {
  if (!stats.previous) return undefined;
  const now = stats.current[key];
  const before = stats.previous[key];
  const diff = now - before;
  if (diff === 0) return { text: `No change vs ${label}`, direction: "flat" };
  const sign = diff > 0 ? "+" : "−";
  const pct = before ? ` (${sign}${Math.round(Math.abs(diff / before) * 100)}%)` : "";
  return { text: `${sign}${format(Math.abs(diff))}${pct} vs ${label}`, direction: diff > 0 ? "up" : "down" };
}

function Tile({
  label,
  value,
  note,
  delta,
}: {
  label: string;
  value: string;
  note?: string;
  delta?: { text: string; direction: "up" | "down" | "flat" };
}) {
  return (
    <div>
      <dt className="mono-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
      {delta && (
        <dd className={`mt-2 text-[0.82rem] ${delta.direction === "up" ? "text-text" : "text-muted"}`}>
          <span aria-hidden className={delta.direction === "up" ? "text-blue-hover" : undefined}>
            {delta.direction === "up" ? "▲ " : delta.direction === "down" ? "▼ " : ""}
          </span>
          {delta.text}
        </dd>
      )}
      {note && <dd className="mt-1 text-[0.82rem] text-hint">{note}</dd>}
    </div>
  );
}

function StageTable({ stages }: { stages: Stats["stages"] }) {
  const total = stages.reduce((n, s) => n + s.count, 0);
  if (!total) return <Empty>No calls booked in this period.</Empty>;
  const max = Math.max(...stages.map((s) => s.count));
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Stage</th>
          <th className="w-1/2">
            <span className="sr-only">Share</span>
          </th>
          <th className="text-right">Leads</th>
          <th className="text-right">Value</th>
        </tr>
      </thead>
      <tbody>
        {stages.map((s) => (
          <tr key={s.stage}>
            <td className="whitespace-nowrap">
              <Link href={`/dashboard/leads?stage=${s.stage}`} className="link">
                {STAGE_LABELS[s.stage]}
              </Link>
            </td>
            <td className="align-middle">
              {s.count > 0 && (
                <div className="h-2 max-w-full bg-blue" style={{ width: `${(s.count / max) * 100}%` }} aria-hidden />
              )}
            </td>
            <td className="text-right tabular-nums">{s.count}</td>
            <td className="whitespace-nowrap text-right tabular-nums">{s.value ? formatMoney(s.value) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="action">
      {children}
      <Icon name="next" />
    </Link>
  );
}
