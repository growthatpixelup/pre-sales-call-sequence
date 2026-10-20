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
  type PeriodStats,
} from "@/lib/analytics";
import { listOpenDrafts } from "@/lib/emails/queue";
import { listReplies, unreadReplyCount } from "@/lib/emails/replies";
import { formatDateTime } from "@/lib/format";
import { listLeads } from "@/lib/leads/store";
import type { Lead } from "@/lib/leads/types";
import { STAGE_LABELS } from "./_components/badges";
import { BookingsChart } from "./_components/bookings-chart";
import { RangeFilter } from "./_components/range-filter";
import { ReplyList } from "./_components/replies";

export const metadata: Metadata = { title: "Overview · Dashboard" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function OverviewPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your call pipeline from Cal.com, and what needs you today.
        </p>
      </div>
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Everything here depends on the current time.
  await connection();
  const [leads, drafts, replies, unread] = await Promise.all([
    listLeads(),
    listOpenDrafts(),
    // Replies need migration 005; the overview still works without it.
    listReplies({ unreadOnly: true, limit: 5 }).catch(() => []),
    unreadReplyCount().catch(() => 0),
  ]);
  const view = buildView(leads, {
    range: param(sp.range),
    from: param(sp.from),
    to: param(sp.to),
    compare: param(sp.compare),
  });
  const { range, stats, snapshot } = view;
  const leadsById = new Map(leads.map((l) => [l.id, l]));
  const leadNames = new Map(leads.map((l) => [l.id, l.name]));
  const compareLabel = range.compare === "year" ? "same period last year" : "previous period";

  return (
    <>
      {/* Right now: not affected by the date range */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Right now</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Upcoming calls"
            value={String(snapshot.upcoming.length)}
            note={`${snapshot.upcomingThisWeek} in the next 7 days${
              snapshot.pendingConfirmation ? ` · ${snapshot.pendingConfirmation} awaiting confirmation` : ""
            }`}
          />
          <Tile label="Open pipeline" value={String(snapshot.open)} note="Leads not yet won, lost or closed" />
          <Tile
            label="Pipeline value"
            value={formatMoneyCompact(snapshot.openValue)}
            note={snapshot.unpriced ? `${snapshot.unpriced} open lead${snapshot.unpriced === 1 ? "" : "s"} without a value` : "Deal value, or the middle of their investment range"}
          />
          <Tile
            label="Unread replies"
            value={String(unread)}
            note={drafts.length ? `${drafts.length} Email 1 draft${drafts.length === 1 ? "" : "s"} to send` : "No Email 1 drafts waiting"}
          />
        </dl>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Next calls" action={<CardLink href="/dashboard/leads?status=upcoming">All upcoming</CardLink>}>
            {snapshot.upcoming.length ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {snapshot.upcoming.slice(0, 5).map((lead) => (
                  <li key={lead.id} className="px-4 py-2.5">
                    <Link href={`/dashboard/leads/${lead.id}`} className="text-sm font-medium hover:underline">
                      {lead.name}
                    </Link>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDateTime(lead.startTime)}
                      {lead.businessName ? ` · ${lead.businessName}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No upcoming calls.</Empty>
            )}
          </Card>

          <Card title="Email 1 to personalise">
            {drafts.length ? (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {drafts.slice(0, 5).map((d) => {
                  const lead = leadsById.get(d.leadId);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{lead?.name ?? "Unknown lead"}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {d.dueAt ? `Best sent around ${formatDateTime(d.dueAt)}` : "Ready to send"}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/leads/${d.leadId}/emails/case_study`}
                        className="shrink-0 rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                      >
                        Personalise &amp; send
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>Nothing to send. New bookings add a draft here.</Empty>
            )}
          </Card>

          <Card title="Unread replies" action={<CardLink href="/dashboard/replies">All replies</CardLink>}>
            {replies.length ? (
              <ReplyList replies={replies} leadNames={leadNames} preview />
            ) : (
              <Empty>No unread replies.</Empty>
            )}
          </Card>
        </div>
      </section>

      {/* Everything below follows the date range */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RangeFilter
            key={`${range.preset}-${range.current.from}-${range.current.to}-${range.compare}`}
            preset={range.preset}
            compare={range.compare}
            from={range.current.from}
            to={range.current.to}
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {formatRange(range.current)}
            {range.previous && <> · vs {formatRange(range.previous)}</>}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Calls booked"
            value={String(stats.current.booked)}
            delta={delta(stats, "booked", compareLabel)}
            note={stats.current.cancelled ? `${stats.current.cancelled} since cancelled` : undefined}
          />
          <Tile label="Calls completed" value={String(stats.current.completed)} delta={delta(stats, "completed", compareLabel)} />
          <Tile
            label="Budget value booked"
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

        <Card title="Calls booked over time">
          <div className="p-4 pt-6">
            <BookingsChart buckets={stats.series.buckets} unit={stats.series.unit} />
          </div>
        </Card>

        <Card
          title="Where those leads are now"
          action={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Win rate{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {stats.winRate == null ? "—" : `${Math.round(stats.winRate * 100)}%`}
              </span>
            </span>
          }
        >
          <StageTable stages={stats.stages} />
        </Card>
      </section>
    </>
  );
}

/** Kept outside the component because it reads the clock. */
function buildView(leads: Lead[], params: Parameters<typeof resolveRange>[0]) {
  const now = new Date();
  const earliest = leads.reduce<string | null>((min, l) => (!min || l.bookedAt < min ? l.bookedAt : min), null);
  const range = resolveRange(params, now, earliest);
  return {
    range,
    stats: buildAnalytics(leads, range, now.getTime()),
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
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
      {delta && (
        <dd
          className={`mt-1 text-xs ${
            delta.direction === "up"
              ? "text-emerald-700 dark:text-emerald-400"
              : delta.direction === "down"
                ? "text-red-700 dark:text-red-400"
                : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          <span aria-hidden>{delta.direction === "up" ? "▲ " : delta.direction === "down" ? "▼ " : ""}</span>
          {delta.text}
        </dd>
      )}
      {note && <dd className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{note}</dd>}
    </div>
  );
}

function StageTable({ stages }: { stages: Stats["stages"] }) {
  const total = stages.reduce((n, s) => n + s.count, 0);
  if (!total) return <Empty>No calls booked in this period.</Empty>;
  const max = Math.max(...stages.map((s) => s.count));
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-zinc-500 dark:text-zinc-400">
        <tr className="border-b border-zinc-200 dark:border-zinc-800">
          <th className="px-4 py-2 font-medium">Stage</th>
          <th className="w-1/2 px-4 py-2 font-medium">
            <span className="sr-only">Share</span>
          </th>
          <th className="px-4 py-2 text-right font-medium">Leads</th>
          <th className="px-4 py-2 text-right font-medium">Value</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {stages.map((s) => (
          <tr key={s.stage}>
            <td className="whitespace-nowrap px-4 py-2">
              <Link href={`/dashboard/leads?stage=${s.stage}`} className="hover:underline">
                {STAGE_LABELS[s.stage]}
              </Link>
            </td>
            <td className="px-4 py-2">
              {s.count > 0 && (
                <div
                  className="h-2 max-w-full rounded-r bg-[#2a78d6] dark:bg-[#3987e5]"
                  style={{ width: `${(s.count / max) * 100}%` }}
                  aria-hidden
                />
              )}
            </td>
            <td className="px-4 py-2 text-right tabular-nums">{s.count}</td>
            <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{s.value ? formatMoney(s.value) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
      {children}
    </Link>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{children}</p>;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
      <div className="h-72 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800" />
    </div>
  );
}
