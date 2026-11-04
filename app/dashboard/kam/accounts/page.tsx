import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { dashboardTimeZone } from "@/lib/analytics";
import { addDays, localDate } from "@/lib/emails/time";
import { formatYmd } from "@/lib/format";
import { listAccounts, listActivity, listMembers, listStakeholders } from "@/lib/kam/store";
import { KAM_STAGES, KAM_STAGE_LABELS, type KamAccount } from "@/lib/kam/types";
import { Empty, Page, PageSkeleton, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";
import { addAccount } from "../actions";
import { MemberSelect } from "../_components/bits";

export const metadata: Metadata = { title: "KAM accounts · GTM OS" };

const TITLE = "Accounts";
const SUB = "Each member works 3–5 companies and about 10 stakeholders across them.";

export default function AccountsPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading accounts" />}>
      <Accounts />
    </Suspense>
  );
}

async function Accounts() {
  await connection();
  const weekStart = addDays(localDate(new Date(), dashboardTimeZone()), -6);
  const [accounts, stakeholders, members, week] = await Promise.all([
    listAccounts(),
    listStakeholders(),
    listMembers(),
    listActivity({ since: weekStart }),
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const byOwner = new Map<string, KamAccount[]>();
  for (const a of accounts) {
    const key = (a.ownerId && memberName.get(a.ownerId)) || "No owner";
    byOwner.set(key, [...(byOwner.get(key) ?? []), a]);
  }

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["Active", <span key="a" className="tabular-nums">{accounts.filter((a) => a.status === "active").length}</span>],
              ["Stakeholders", <span key="s" className="tabular-nums">{stakeholders.length}</span>],
              ...KAM_STAGES.map(
                (stage) =>
                  [KAM_STAGE_LABELS[stage], <span key={stage} className="tabular-nums">{stakeholders.filter((s) => s.stage === stage).length}</span>] as [
                    string,
                    ReactNode,
                  ],
              ),
            ]}
          />
        </>
      }
    >
      <Section label="Add an account">
        <form action={addAccount} className="form-grid">
          <label className="field">
            <span className="mono-label">Company</span>
            <input name="company" required className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Website</span>
            <input name="website" placeholder="acme.io" className="input" />
          </label>
          <MemberSelect members={members} name="ownerId" label="Owner" />
          <div className="form-wide">
            <button type="submit" className="btn">
              Add account
            </button>
          </div>
        </form>
      </Section>

      {accounts.length === 0 ? (
        <Section label="Accounts">
          <Empty>No accounts yet.</Empty>
        </Section>
      ) : (
        [...byOwner.entries()].map(([owner, list]) => (
          <Section key={owner} label={`${owner} · ${list.length}`}>
            <ul className="list">
              {list.map((a) => {
                const people = stakeholders.filter((s) => s.accountId === a.id);
                const touches = week.filter((t) => t.accountId === a.id).reduce((n, t) => n + t.count, 0);
                const last = people.reduce<string | null>((max, s) => (s.lastTouchAt && (!max || s.lastTouchAt > max) ? s.lastTouchAt : max), null);
                return (
                  <li key={a.id}>
                    <div className="item">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {a.status !== "active" && <Tag tone="muted">{a.status}</Tag>}
                          {KAM_STAGES.map((stage) => {
                            const n = people.filter((s) => s.stage === stage).length;
                            return n ? (
                              <Tag key={stage} tone="neutral">
                                {KAM_STAGE_LABELS[stage]} {n}
                              </Tag>
                            ) : null;
                          })}
                        </div>
                        <Link href={`/dashboard/kam/accounts/${a.id}`} className="item-title mt-3 inline-block">
                          {a.company}
                        </Link>
                        <p className="m-0 mt-1 text-[0.92rem] text-muted">
                          {people.length} stakeholder{people.length === 1 ? "" : "s"} · {touches} touch{touches === 1 ? "" : "es"} this week
                          {last ? ` · last ${formatYmd(last.slice(0, 10))}` : ""}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))
      )}
    </Page>
  );
}
