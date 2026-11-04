import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatYmd } from "@/lib/format";
import { matchAccount } from "@/lib/kam/match";
import { listAccounts, listMembers, listSlackMessages, listStakeholders, listUnmatched } from "@/lib/kam/store";
import { ACTIVITY_TYPE_LABELS, PLATFORM_LABELS } from "@/lib/kam/types";
import { Empty, Page, PageSkeleton, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";
import { assignTouch, createFromTouch, dismissTouch } from "../actions";
import { MemberSelect, StakeholderSelect } from "../_components/bits";

export const metadata: Metadata = { title: "KAM review · GTM OS" };

const TITLE = "Review";
const SUB =
  "Touches from Slack that name someone we couldn't match to a stakeholder. Point each at the right person, add them as a new stakeholder, or leave it unmatched.";

export default function ReviewPage() {
  return (
    <Suspense fallback={<PageSkeleton title={TITLE} sub={SUB} label="Loading review" />}>
      <Review />
    </Suspense>
  );
}

async function Review() {
  await connection();
  const [unmatched, stakeholders, accounts, members, messages] = await Promise.all([
    listUnmatched(),
    listStakeholders(),
    listAccounts(),
    listMembers(),
    listSlackMessages(["needs_review", "logged"], 200),
  ]);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const messageText = new Map(messages.map((m) => [m.id, m.text]));

  return (
    <Page
      rail={
        <>
          <RailIntro title={TITLE} sub={SUB} />
          <Rows rows={[["To review", <span key="n" className="tabular-nums">{unmatched.length}</span>]]} />
        </>
      }
    >
      <Section label={`Unmatched · ${unmatched.length}`}>
        {unmatched.length ? (
          <ul className="list">
            {unmatched.map((a) => {
              const guess = matchAccount(a.companyName, accounts);
              const sameAccount = stakeholders.filter((s) => s.accountId === (a.accountId ?? guess?.id));
              const source = a.slackMessageId ? messageText.get(a.slackMessageId) : null;
              return (
                <li key={a.id} className="py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone="neutral">
                      {ACTIVITY_TYPE_LABELS[a.type]}
                      {a.count > 1 ? ` ×${a.count}` : ""}
                    </Tag>
                    <span className="hint">
                      {formatYmd(a.day)} · {(a.memberId && memberName.get(a.memberId)) ?? "Unknown"} · {PLATFORM_LABELS[a.platform]}
                    </span>
                  </div>
                  <p className="item-title m-0 mt-3">
                    {a.personName}
                    {(a.companyName || a.accountId) && (
                      <span className="text-muted"> · {a.accountId ? accounts.find((x) => x.id === a.accountId)?.company : a.companyName}</span>
                    )}
                  </p>
                  {a.note && <p className="m-0 mt-1 text-body">{a.note}</p>}
                  {a.link && (
                    <a href={a.link} target="_blank" rel="noopener noreferrer" className="link mt-1 inline-block break-all text-[0.85rem]">
                      {a.link}
                    </a>
                  )}
                  {source && (
                    <details className="mt-2">
                      <summary className="mono-label cursor-pointer hover:text-text">Slack update</summary>
                      <p className="preview m-0 mt-2 whitespace-pre-wrap !p-3 text-[0.85rem]">{source}</p>
                    </details>
                  )}

                  <div className="mt-5 grid gap-6 lg:grid-cols-2">
                    <form action={assignTouch.bind(null, a.id)} className="grid content-start gap-3">
                      <StakeholderSelect stakeholders={stakeholders} accounts={accounts} label="It was" required first={sameAccount} />
                      <button type="submit" className="action justify-self-start">
                        Assign
                      </button>
                    </form>
                    <form action={createFromTouch.bind(null, a.id)} className="grid content-start gap-3">
                      <label className="field">
                        <span className="mono-label">New stakeholder</span>
                        <input name="name" defaultValue={a.personName ?? ""} required className="input" />
                      </label>
                      <label className="field">
                        <span className="mono-label">Account</span>
                        <select name="accountId" defaultValue={a.accountId ?? guess?.id ?? "new"} className="input">
                          <option value="new">New account{a.companyName ? `: ${a.companyName}` : ""}</option>
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.company}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="mono-label">Company, for a new account</span>
                        <input name="company" defaultValue={a.companyName ?? ""} className="input" />
                      </label>
                      <input type="hidden" name="link" value={a.link ?? ""} />
                      <MemberSelect members={members} name="ownerId" label="Owner" value={a.memberId} />
                      <button type="submit" className="action justify-self-start">
                        Add &amp; assign
                      </button>
                    </form>
                  </div>
                  <form action={dismissTouch.bind(null, a.id)} className="mt-4">
                    <button type="submit" className="action">
                      Leave unmatched
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nothing to review.</Empty>
        )}
      </Section>
    </Page>
  );
}
