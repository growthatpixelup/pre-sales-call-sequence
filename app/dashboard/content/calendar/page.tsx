import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatTime } from "@/lib/emails/time";
import { formatDateTime } from "@/lib/format";
import { HEALTH_LABELS, buildCalendar, mergeSchedulers, type DayCell, type Health } from "@/lib/content/calendar";
import { CADENCE, SCHEDULER_FOR, TOOLS } from "@/lib/content/config";
import { plural } from "@/lib/content/format";
import { loadScheduler, timeZone } from "@/lib/content/sources";
import {
  PLATFORM_LABELS,
  POST_STATUS_LABELS,
  SCHEDULERS,
  SCHEDULER_LABELS,
  type CalendarPost,
  type PostStatus,
} from "@/lib/content/types";
import { ContentHeader, ContentSection, EmptyNotice, SourceNotice, StatGrid } from "../_components/kit";
import { PlatformTag } from "../_components/post-card";

export const metadata: Metadata = { title: "Calendar · Content OS" };

const SUB = "Everything published, queued, drafted or failed in Typefully and Buffer, and whether the queue keeps up with the posting cadence.";
const LINKS = [TOOLS.typefully, TOOLS.buffer];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "X 2 a day (17:00, 21:00); LinkedIn Mon, Wed, Fri (21:00)". */
function cadenceText() {
  return (["x", "linkedin"] as const)
    .map((p) => {
      const c = CADENCE[p];
      if (c.byWeekday) {
        const days = WEEKDAYS.filter((_, i) => c.byWeekday![i].length);
        const times = [...new Set(c.byWeekday.flat())].join(", ");
        return `${PLATFORM_LABELS[p]} ${days.join(", ")} (${times})`;
      }
      const when = c.everyNDays === 1 ? "a day" : `every ${c.everyNDays} days`;
      return `${PLATFORM_LABELS[p]} ${c.slots.length} ${when} (${c.slots.join(", ")})`;
    })
    .join("; ");
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Calendar />
    </Suspense>
  );
}

async function Calendar() {
  // Health, runway and the grid all depend on the current time.
  await connection();
  const now = new Date();
  const tz = timeZone();
  const results = await Promise.all(SCHEDULERS.map((s) => loadScheduler(s, now)));
  const problems = results.filter((r) => r.status !== "ok");
  const okResults = results.filter((r) => r.status === "ok");

  if (!okResults.length) {
    return (
      <>
        <ContentHeader title="Calendar" sub={SUB} stats={[]} links={LINKS} />
        <ContentSection label="Schedulers">
          <div className="grid gap-3">
            {problems.map((p) => <SourceNotice key={p.source} result={p} />)}
          </div>
        </ContentSection>
      </>
    );
  }

  const posts = mergeSchedulers(okResults.flatMap((r) => r.data));
  const view = buildCalendar(posts, now, tz);
  const { next7, last14 } = view;

  return (
    <>
      <ContentHeader
        title="Calendar"
        sub={SUB}
        links={LINKS}
        stats={[
          {
            label: "Health",
            value: <HealthValue health={view.health} />,
            sub: `${next7.filled} of ${next7.target} slots filled this week`,
          },
          { label: "Runway", value: plural(view.runwayDays, "day"), sub: `${plural(view.queued, "post")} queued` },
          {
            label: "Cadence",
            value: `${last14.posted}/${last14.target}`,
            sub: `Posted vs target, last 14 days`,
          },
          { label: "Backlog", value: plural(view.drafts.length, "draft"), sub: "Not given a slot yet" },
        ]}
      >
        <p className="m-0 text-[0.85rem] text-muted">Goal: {cadenceText()}. Times in {tz.replace("Asia/Kolkata", "India time")}.</p>
      </ContentHeader>

      {problems.length > 0 && (
        <ContentSection label="Schedulers">
          <div className="grid gap-3">
            {problems.map((p) => <SourceNotice key={p.source} result={p} />)}
          </div>
          <p className="m-0 mt-3 text-[0.85rem] text-muted">
            The calendar below only shows the scheduler that loaded, so health and runway may read low.
          </p>
        </ContentSection>
      )}

      <ContentSection label="Issues" explain="What needs fixing to keep the cadence, most urgent first.">
        {view.issues.length ? (
          <div className="callout" role="note">
            <ul className="m-0 grid gap-1.5 pl-5">
              {view.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyNotice title="Nothing to fix.">Every slot this week is filled and nothing failed.</EmptyNotice>
        )}
      </ContentSection>

      <ContentSection
        label="Pipeline health"
        explain="Slots are the target cadence's posting times. A slot is filled when a post is scheduled or published that day."
      >
        <StatGrid
          stats={[
            { label: "Next 7 days", value: `${next7.filled}/${next7.target}`, sub: "Slots filled" },
            {
              label: "Last 14 days",
              value: `${last14.posted}/${last14.target}`,
              sub: `X ${last14.byPlatform.x.posted}/${last14.byPlatform.x.target} · LinkedIn ${last14.byPlatform.linkedin.posted}/${last14.byPlatform.linkedin.target}`,
            },
            { label: "Drafts", value: String(view.drafts.length), sub: "In the backlog" },
            { label: "Failed", value: String(view.failed.length), sub: "Last 14 days" },
          ]}
        />
      </ContentSection>

      <ContentSection
        label="Four weeks"
        explain="Last week, this week and the next two. Open slots link to the scheduler that fills them."
        aside={<Legend />}
      >
        <Grid weeks={view.weeks} tz={tz} />
      </ContentSection>

      {view.failed.length > 0 && (
        <ContentSection label={`Failed publishes · ${view.failed.length}`} explain="Posts a scheduler tried to publish and couldn't. Fix the cause, then reschedule.">
          <ul className="list">
            {view.failed.map((p) => (
              <li key={p.id}>
                <div className="item">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <PlatformTag platform={p.platform} />
                      <span className="mono-label">{formatDateTime(p.at!)}</span>
                      <span className="text-[0.82rem] text-muted">{p.schedulers.map((s) => SCHEDULER_LABELS[s]).join(" + ")}</span>
                    </div>
                    <p className="m-0 mt-2 line-clamp-2 text-body">{p.text}</p>
                    {p.error && <p className="m-0 mt-2 text-[0.9rem] text-bad">{p.error}</p>}
                  </div>
                  <div className="item-actions">
                    <a href={TOOLS[p.schedulers[0]].href} target="_blank" rel="noopener noreferrer" className="action">
                      Open {SCHEDULER_LABELS[p.schedulers[0]]}
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </ContentSection>
      )}
    </>
  );
}

const HEALTH_DOT: Record<Health, string> = { healthy: "bg-good", attention: "bg-warn", dry: "bg-bad" };

function HealthValue({ health }: { health: Health }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[clamp(1.2rem,2vw,1.6rem)]">
      <span aria-hidden className={`size-3 shrink-0 ${HEALTH_DOT[health]}`} />
      {HEALTH_LABELS[health]}
    </span>
  );
}

/** Left border colour per status; the status is also in text for screen readers and on hover. */
const STATUS_BORDER: Record<PostStatus, string> = {
  published: "border-l-good",
  scheduled: "border-l-blue",
  planned: "border-l-blue border-dashed",
  draft: "border-l-muted",
  failed: "border-l-bad",
};

function Legend() {
  const items: { label: string; className: string }[] = [
    { label: POST_STATUS_LABELS.published, className: "border-l-4 border-l-good" },
    { label: POST_STATUS_LABELS.scheduled, className: "border-l-4 border-l-blue" },
    { label: "Planned (not confirmed)", className: "border-l-4 border-dashed border-l-blue" },
    { label: POST_STATUS_LABELS.failed, className: "border-l-4 border-l-bad" },
    { label: "Open slot", className: "border border-dashed border-line-2" },
  ];
  return (
    <div className="mono-label flex flex-wrap gap-4" aria-label="Legend">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className={`h-3 w-3 bg-panel ${i.className}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const WEEK_LABELS = ["Last week", "This week", "Next week", "In two weeks"];
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function Grid({ weeks, tz }: { weeks: DayCell[][]; tz: string }) {
  return (
    <div className="grid gap-6">
      {weeks.map((week, w) => (
        <div key={week[0].date}>
          <h3 className="mono-label m-0 mb-2">{WEEK_LABELS[w]}</h3>
          <ol className="m-0 grid list-none grid-cols-1 border-t border-l border-line p-0 md:grid-cols-7">
            {week.map((day) => (
              <li
                key={day.date}
                className={`min-h-28 min-w-0 border-r border-b border-line p-2 ${day.isToday ? "bg-panel shadow-[inset_0_2px_0_0_var(--blue)]" : ""} ${day.isPast ? "opacity-80" : ""}`}
                aria-current={day.isToday ? "date" : undefined}
              >
                <div className={`mb-2 flex items-center justify-between font-mono text-[0.72rem] tracking-[0.06em] uppercase ${day.isToday ? "text-text" : "text-muted"}`}>
                  <span>{dayFmt.format(new Date(`${day.date}T12:00:00Z`))}</span>
                  {day.isToday && <span className="text-blue">Today</span>}
                </div>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {day.posts.map((p) => (
                    <PostChip key={p.id} post={p} tz={tz} />
                  ))}
                  {day.openSlots.map((s, i) => (
                    <li key={`${s.platform}-${s.time}-${i}`}>
                      <a
                        href={TOOLS[SCHEDULER_FOR[s.platform]].href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 border border-dashed border-line-2 px-2 py-1 text-[0.75rem] text-muted no-underline hover:border-muted hover:text-text"
                      >
                        <span className="tabular-nums">{s.time}</span>
                        <PlatformDot platform={s.platform} />
                        <span>Open slot</span>
                      </a>
                    </li>
                  ))}
                  {!day.posts.length && !day.openSlots.length && <li className="text-[0.75rem] text-hint">—</li>}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function PostChip({ post, tz }: { post: CalendarPost; tz: string }) {
  const firstLine = post.text.split("\n").find((l) => l.trim()) ?? "";
  const label = `${POST_STATUS_LABELS[post.status]} · ${PLATFORM_LABELS[post.platform]} · ${post.schedulers.map((s) => SCHEDULER_LABELS[s]).join(" + ")}`;
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[0.72rem] text-muted">
        <span className="tabular-nums">{formatTime(new Date(post.at!), tz)}</span>
        <PlatformDot platform={post.platform} />
        <span className="sr-only">{label}</span>
        {post.status === "failed" && <span className="text-bad">Failed</span>}
        {post.status === "planned" && <span>Planned</span>}
      </span>
      <span className="line-clamp-2 text-[0.78rem] text-body">{firstLine}</span>
    </>
  );
  const cls = `flex flex-col gap-0.5 border-l-[3px] bg-panel px-2 py-1 no-underline ${STATUS_BORDER[post.status]}`;
  return (
    <li title={label}>
      {post.url ? (
        <a href={post.url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-panel-2`}>
          {body}
        </a>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

function PlatformDot({ platform }: { platform: CalendarPost["platform"] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={`size-1.5 ${platform === "x" ? "bg-series-x" : "bg-series-li"}`} />
      <span className="font-mono text-[0.68rem] uppercase">{PLATFORM_LABELS[platform]}</span>
    </span>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading calendar">
      <ContentHeader title="Calendar" sub={SUB} stats={[]} links={LINKS} />
      <div className="grid gap-px px-4 py-8 sm:px-[30px]">
        <div className="skeleton h-24" />
        <div className="skeleton h-[28rem]" />
      </div>
    </div>
  );
}
