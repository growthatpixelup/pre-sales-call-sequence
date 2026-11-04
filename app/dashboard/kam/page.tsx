import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatYmd } from "@/lib/format";
import { listSlackMessages } from "@/lib/kam/store";
import { DAILY_TARGETS, KAM_STAGE_LABELS, type KamStakeholder } from "@/lib/kam/types";
import { loadTeam } from "@/lib/kam/views";
import { Callout, Empty, Icon, Page, PageSkeleton, RailActions, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";
import { addKamMember, retryFailedUpdates } from "./actions";
import { ActivityList, QuickLogForm } from "./_components/bits";
import { SlackSyncButton } from "./_components/slack-sync-button";

export const metadata: Metadata = { title: "KAM · GTM OS" };

const TITLE = "KAM";
const SUB = "The team's daily touches on key accounts, read from #account-based-marketing every 15 minutes.";

export default function KamPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading KAM" />}>
      <Team />
    </Suspense>
  );
}

const { engagement: E, dms: D } = DAILY_TARGETS;

async function Team() {
  // "Today" depends on the current time.
  await connection();
  const [view, failed] = await Promise.all([loadTeam(new Date()), listSlackMessages(["failed"], 20)]);
  const { team, unmatched, cold, recent, members, accounts, stakeholders, days, today } = view;
  const behind = team.filter((t) => t.behind);
  const company = new Map(accounts.map((a) => [a.id, a.company]));

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Behind today", <span key="b" className="tabular-nums">{team.length ? `${behind.length} of ${team.length}` : "—"}</span>],
              ["To review", <span key="r" className="tabular-nums">{unmatched.length}</span>],
              ["Going cold", <span key="c" className="tabular-nums">{cold.length}</span>],
              ["Daily target", `${E.min}–${E.max} likes & comments, ${D.min}–${D.max} DMs`],
            ]}
          />
          <RailActions>
            {unmatched.length > 0 && (
              <Link href="/dashboard/kam/review" className="btn-primary">
                Review {unmatched.length} unmatched
                <Icon name="next" />
              </Link>
            )}
            <SlackSyncButton />
          </RailActions>
        </>
      }
    >
      {failed.length > 0 && (
        <div className="pt-7">
          <Callout title={`${failed.length} Slack update${failed.length === 1 ? "" : "s"} couldn’t be read.`}>
            {failed[0].error}
            <form action={retryFailedUpdates} className="mt-3">
              <button type="submit" className="action">
                Try again
              </button>
            </form>
          </Callout>
        </div>
      )}

      <Section label={`Today · ${formatYmd(today)}`}>
        {team.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th className="text-right">Likes &amp; comments</th>
                <th className="text-right">DMs</th>
                <th className="text-right">Other</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {team.map(({ member, today: t, behind: late }) => (
                <tr key={member.id}>
                  <td className="whitespace-nowrap font-medium">
                    <Link href={`/dashboard/kam/members/${member.id}`} className="link">
                      {member.name}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">
                    {t.engagement} <span className="text-hint">/ {E.min}–{E.max}</span>
                  </td>
                  <td className="text-right tabular-nums">
                    {t.dms} <span className="text-hint">/ {D.min}–{D.max}</span>
                  </td>
                  <td className="text-right tabular-nums">{t.other || "—"}</td>
                  <td className="text-right">{late ? <Tag>Behind</Tag> : <Tag tone="neutral">On track</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No members yet. They’re added when they first post in the channel, or below.</Empty>
        )}
      </Section>

      {team.length > 0 && (
        <Section label="This week" aside={<p className="hint m-0">Likes &amp; comments / DMs per day.</p>}>
          <div className="overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Member</th>
                  {days.map((d) => (
                    <th key={d} className="text-right">
                      {formatYmd(d).replace(/ \d{4}$/, "")}
                    </th>
                  ))}
                  <th className="text-right">Week</th>
                </tr>
              </thead>
              <tbody>
                {team.map(({ member, week, weekTotal }) => (
                  <tr key={member.id}>
                    <td className="whitespace-nowrap font-medium">
                    <Link href={`/dashboard/kam/members/${member.id}`} className="link">
                      {member.name}
                    </Link>
                  </td>
                    {week.map((d) => (
                      <td key={d.day} className={`text-right tabular-nums ${d.engagement + d.dms ? "" : "text-hint"}`}>
                        {d.engagement}/{d.dms}
                      </td>
                    ))}
                    <td className="text-right tabular-nums text-text">
                      {weekTotal.engagement}/{weekTotal.dms}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section label="Quick log" aside={<p className="hint m-0">For anything not posted in Slack.</p>}>
        <QuickLogForm members={members.filter((m) => m.active)} stakeholders={stakeholders} accounts={accounts} />
      </Section>

      <Section label={`Going cold · ${cold.length}`} aside={<p className="hint m-0">No touch in 7+ days, on active accounts.</p>}>
        {cold.length ? <ColdList cold={cold} company={company} /> : <Empty>Nobody’s going cold.</Empty>}
      </Section>

      <Section label="Recent touches">
        {recent.length ? (
          <ActivityList activity={recent} members={members} stakeholders={stakeholders} accounts={accounts} />
        ) : (
          <Empty>No touches this week yet.</Empty>
        )}
      </Section>

      <Section label="Members" aside={<p className="hint m-0">Anyone posting in the channel is added automatically.</p>}>
        <p className="m-0 mb-4 text-body">{members.map((m) => m.name).join(", ") || "None yet."}</p>
        <form action={addKamMember} className="flex max-w-[68ch] gap-2">
          <input name="name" placeholder="Name" aria-label="Member name" className="input input-sm flex-1" />
          <button type="submit" className="action">
            Add member
          </button>
        </form>
      </Section>
    </Page>
  );
}

function ColdList({ cold, company }: { cold: KamStakeholder[]; company: Map<string, string> }) {
  return (
    <ul className="list">
      {cold.slice(0, 20).map((s) => (
        <li key={s.id}>
          <div className="item">
            <div className="min-w-0">
              <Link href={`/dashboard/kam/accounts/${s.accountId}`} className="item-title">
                {s.name}
              </Link>
              <p className="m-0 mt-1 text-[0.92rem] text-muted">
                {company.get(s.accountId)} · {KAM_STAGE_LABELS[s.stage]} ·{" "}
                {s.lastTouchAt ? `last touch ${formatYmd(s.lastTouchAt.slice(0, 10))}` : "never touched"}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
