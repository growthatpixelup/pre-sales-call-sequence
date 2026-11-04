import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatMoneyCompact } from "@/lib/analytics";
import { loadWins } from "@/lib/kam/views";
import { DEAL_TYPE_LABELS, WON_STAGES, leadName } from "@/lib/leads/types";
import { StageBadge } from "@/app/dashboard/_components/badges";
import { money } from "@/app/dashboard/_components/lead-bits";
import { Empty, Page, PageSkeleton, RailIntro, Rows, Section } from "@/app/dashboard/_components/ui";
import { saveWinNote } from "../actions";

export const metadata: Metadata = { title: "KAM wins · GTM OS" };

const TITLE = "KAM wins";
const SUB =
  "Pipeline deals with Source = KAM. A stakeholder set to Call booked lands here, and any lead can be attributed to a stakeholder from its lead page.";

export default function WinsPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading KAM wins" />}>
      <Wins />
    </Suspense>
  );
}

const round = (n: number | null) => (n == null ? "—" : String(Math.round(n * 10) / 10));

async function Wins() {
  await connection();
  const { rows, stats, members, accounts } = await loadWins();
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const company = new Map(accounts.map((a) => [a.id, a.company]));
  const sorted = [...rows].sort(
    (a, b) => Number(WON_STAGES.includes(b.lead.stage)) - Number(WON_STAGES.includes(a.lead.stage)) || (a.lead.updatedAt < b.lead.updatedAt ? 1 : -1),
  );

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows
            rows={[
              ["KAM revenue", <span key="r" className="tabular-nums">{formatMoneyCompact(stats.revenue)}</span>],
              ["Deals won", <span key="w" className="tabular-nums">{stats.won}</span>],
              ["Open deals", <span key="o" className="tabular-nums">{stats.open}</span>],
              ["Avg days to close", <span key="d" className="tabular-nums">{round(stats.avgDaysToClose)}</span>],
              ["Avg touches before reply", <span key="t" className="tabular-nums">{round(stats.avgTouchesBeforeReply)}</span>],
            ]}
          />
        </>
      }
    >
      <Section label={`Deals · ${rows.length}`}>
        {sorted.length ? (
          <ul className="list">
            {sorted.map(({ lead, stakeholder, daysToClose, touchesBeforeReply }) => (
              <li key={lead.id} className="py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StageBadge stage={lead.stage} />
                  <span className="hint">{DEAL_TYPE_LABELS[lead.dealType]}</span>
                </div>
                <Link href={`/dashboard/leads/${lead.id}`} className="item-title mt-3 inline-block">
                  {leadName(lead)}
                  {lead.company && lead.contactName ? ` · ${lead.company}` : ""}
                </Link>
                <p className="m-0 mt-1 text-[0.92rem] text-muted">
                  {[
                    stakeholder ? `${stakeholder.name} (${company.get(stakeholder.accountId) ?? "?"})` : "No stakeholder linked",
                    stakeholder?.ownerId ? memberName.get(stakeholder.ownerId) : null,
                    money(lead),
                    lead.stage === "paid" ? "Paid" : WON_STAGES.includes(lead.stage) ? "Not paid yet" : null,
                    daysToClose != null ? `${daysToClose} days first touch → close` : null,
                    touchesBeforeReply != null ? `${touchesBeforeReply} touches before first reply` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <form action={saveWinNote.bind(null, lead.id)} className="mt-3 flex max-w-[68ch] gap-2">
                  <input
                    name="winNote"
                    defaultValue={lead.winNote ?? ""}
                    placeholder="How we won it"
                    aria-label="How we won it"
                    className="input input-sm flex-1"
                  />
                  <button type="submit" className="action">
                    Save
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No KAM deals yet.</Empty>
        )}
      </Section>
    </Page>
  );
}
