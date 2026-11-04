import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { dashboardTimeZone } from "@/lib/analytics";
import { addDays, localDate } from "@/lib/emails/time";
import { formatYmd } from "@/lib/format";
import { listAccounts, listActivity, listMembers, listStakeholders } from "@/lib/kam/store";
import { DAILY_TARGETS, KAM_STAGES, KAM_STAGE_LABELS, type KamActivity } from "@/lib/kam/types";
import { Empty, Page, PageSkeleton, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";
import { QuickLogForm } from "../../_components/bits";

export const metadata: Metadata = { title: "KAM member · GTM OS" };

/** One member's KAM: their daily log, their accounts and their POCs (like their Notion page). */
export default function MemberPage({ params }: PageProps<"/dashboard/kam/members/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Member" label="Loading member" />}>
      <Member params={params} />
    </Suspense>
  );
}

const LOG_DAYS = 30;
const { engagement: E, dms: D } = DAILY_TARGETS;

async function Member({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const today = localDate(new Date(), dashboardTimeZone());
  const [members, accounts, stakeholders, activity] = await Promise.all([
    listMembers(),
    listAccounts(),
    listStakeholders(),
    listActivity({ since: addDays(today, -(LOG_DAYS - 1)) }),
  ]);
  const member = members.find((m) => m.id === id);
  if (!member) notFound();

  const myAccounts = accounts.filter((a) => a.ownerId === member.id);
  const myAccountIds = new Set(myAccounts.map((a) => a.id));
  // Their POCs: stakeholders they own, or on accounts they own.
  const mine = stakeholders.filter((s) => s.ownerId === member.id || myAccountIds.has(s.accountId));
  const theirActivity = activity.filter((a) => a.memberId === member.id);
  const person = new Map(stakeholders.map((s) => [s.id, s.name]));
  const company = new Map(accounts.map((a) => [a.id, a.company]));

  const log = Array.from({ length: LOG_DAYS }, (_, i) => addDays(today, -i)).map((day) => {
    const list = theirActivity.filter((a) => a.day === day);
    const sum = (pred: (a: KamActivity) => boolean) => list.filter(pred).reduce((n, a) => n + a.count, 0);
    const dmed = list.filter((a) => a.type === "dm").map((a) => (a.stakeholderId ? person.get(a.stakeholderId) : a.personName) ?? "someone");
    return { day, likes: sum((a) => a.type === "like"), comments: sum((a) => a.type === "comment"), dms: sum((a) => a.type === "dm"), dmed };
  });
  const todayRow = log[0];
  const loggedDays = log.filter((d) => d.likes + d.comments + d.dms > 0);

  return (
    <Page
      rail={
        <>
          <RailIntro
            title={member.name}
            sub={`Every day: ${E.min}–${E.max} likes and comments, ${D.min}–${D.max} DMs.`}
            back={{ href: "/dashboard/kam", label: "Team" }}
          />
          <Rows
            rows={[
              ["Today", <span key="t" className="tabular-nums">{todayRow.likes + todayRow.comments} likes & comments · {todayRow.dms} DMs</span>],
              ["Accounts", <span key="a" className="tabular-nums">{myAccounts.length}</span>],
              ["POCs", <span key="p" className="tabular-nums">{mine.length}</span>],
              ...KAM_STAGES.filter((st) => mine.some((s) => s.stage === st)).map(
                (st) => [KAM_STAGE_LABELS[st], String(mine.filter((s) => s.stage === st).length)] as [string, string],
              ),
            ]}
          />
        </>
      }
    >
      <Section label="Daily log" aside={<p className="hint m-0">Last {LOG_DAYS} days, from Slack and quick logs.</p>}>
        {loggedDays.length ? (
          <div className="overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="text-right">Likes</th>
                  <th className="text-right">Comments</th>
                  <th className="text-right">DMs</th>
                  <th>DMs sent to</th>
                </tr>
              </thead>
              <tbody>
                {loggedDays.map((d) => (
                  <tr key={d.day}>
                    <td className="whitespace-nowrap">{formatYmd(d.day)}</td>
                    <td className="text-right tabular-nums">{d.likes}</td>
                    <td className="text-right tabular-nums">{d.comments}</td>
                    <td className="text-right tabular-nums">{d.dms}</td>
                    <td>{d.dmed.join(", ") || <span className="text-hint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nothing logged in the last {LOG_DAYS} days.</Empty>
        )}
      </Section>

      <Section label={`Accounts · ${myAccounts.length}`} aside={<p className="hint m-0">Aim for 3–5.</p>}>
        {myAccounts.length ? (
          <ul className="list">
            {myAccounts.map((a) => {
              const people = mine.filter((s) => s.accountId === a.id);
              return (
                <li key={a.id}>
                  <div className="item">
                    <div className="min-w-0">
                      <Link href={`/dashboard/kam/accounts/${a.id}`} className="item-title">
                        {a.company}
                      </Link>
                      <p className="m-0 mt-1 text-[0.92rem] text-muted">
                        {people.length ? people.map((s) => `${s.name} (${KAM_STAGE_LABELS[s.stage]})`).join(", ") : "No POCs yet"}
                      </p>
                    </div>
                    {a.status !== "active" && (
                      <div className="item-actions">
                        <Tag tone="muted">{a.status}</Tag>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>
            No accounts yet. <Link href="/dashboard/kam/accounts" className="link">Add one</Link> with {member.name.split(" ")[0]} as owner.
          </Empty>
        )}
      </Section>

      <Section label={`POCs · ${mine.length}`}>
        {mine.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Stage</th>
                <th>Last touch</th>
              </tr>
            </thead>
            <tbody>
              {[...mine]
                .sort((a, b) => (a.lastTouchAt ?? "") < (b.lastTouchAt ?? "") ? -1 : 1)
                .map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/dashboard/kam/accounts/${s.accountId}`} className="link">
                        {s.name}
                      </Link>
                    </td>
                    <td>{company.get(s.accountId)}</td>
                    <td>{KAM_STAGE_LABELS[s.stage]}</td>
                    <td className="whitespace-nowrap">{s.lastTouchAt ? formatYmd(s.lastTouchAt.slice(0, 10)) : <span className="text-hint">Never</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <Empty>No POCs yet.</Empty>
        )}
      </Section>

      <Section label="Quick log">
        <QuickLogForm members={members} stakeholders={mine.length ? mine : stakeholders} accounts={accounts} memberId={member.id} />
      </Section>
    </Page>
  );
}
