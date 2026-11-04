import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatYmd } from "@/lib/format";
import { getAccount, listAccounts, listActivity, listMembers, listStakeholders } from "@/lib/kam/store";
import { ACCOUNT_STATUSES, KAM_STAGES, KAM_STAGE_LABELS, type KamMember, type KamStakeholder } from "@/lib/kam/types";
import { Empty, Icon, Page, PageSkeleton, RailIntro, Rows, Section, Tag } from "@/app/dashboard/_components/ui";
import { addStakeholder, saveAccount, saveStakeholder } from "../../actions";
import { ActivityList, MemberSelect } from "../../_components/bits";

export const metadata: Metadata = { title: "KAM account · GTM OS" };

export default function AccountPage({ params }: PageProps<"/dashboard/kam/accounts/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton title="Account" label="Loading account" />}>
      <AccountDetail params={params} />
    </Suspense>
  );
}

async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const account = await getAccount(id);
  if (!account) notFound();
  const [stakeholders, members, activity, accounts] = await Promise.all([
    listStakeholders(account.id),
    listMembers(),
    listActivity({ accountId: account.id, limit: 200 }),
    listAccounts(),
  ]);
  const owner = members.find((m) => m.id === account.ownerId)?.name ?? null;

  return (
    <Page
      rail={
        <>
          <RailIntro title={account.company} sub={owner ? `Owner: ${owner}` : "No owner yet"} back={{ href: "/dashboard/kam/accounts", label: "Accounts" }}>
            {account.status !== "active" && (
              <div className="mt-5">
                <Tag tone="muted">{account.status}</Tag>
              </div>
            )}
          </RailIntro>
          <Rows
            rows={[
              ["Website", account.website ? <a key="w" href={/^https?:/.test(account.website) ? account.website : `https://${account.website}`} target="_blank" rel="noopener noreferrer" className="link">{account.domain ?? account.website}</a> : null],
              ["Stakeholders", String(stakeholders.length)],
              ...KAM_STAGES.filter((s) => stakeholders.some((p) => p.stage === s)).map(
                (s) => [KAM_STAGE_LABELS[s], String(stakeholders.filter((p) => p.stage === s).length)] as [string, string],
              ),
            ]}
          />
        </>
      }
    >
      <Section label={`Stakeholders · ${stakeholders.length}`}>
        {stakeholders.length ? (
          <ul className="list">
            {stakeholders.map((s) => (
              <li key={s.id}>
                <StakeholderItem stakeholder={s} members={members} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No stakeholders yet. Aim for 2–3 people per account.</Empty>
        )}
      </Section>

      <Section label="Add a stakeholder">
        <form action={addStakeholder.bind(null, account.id)} className="form-grid">
          <label className="field">
            <span className="mono-label">Name</span>
            <input name="name" required className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Role</span>
            <input name="role" placeholder="e.g. Founder, Head of Design" className="input" />
          </label>
          <label className="field">
            <span className="mono-label">LinkedIn URL</span>
            <input name="linkedinUrl" className="input" />
          </label>
          <label className="field">
            <span className="mono-label">X URL</span>
            <input name="xUrl" className="input" />
          </label>
          <MemberSelect members={members} name="ownerId" label="Owner" value={account.ownerId} />
          <div className="form-wide">
            <button type="submit" className="btn">
              Add stakeholder
            </button>
          </div>
        </form>
      </Section>

      <Section label="Touches">
        {activity.length ? (
          <ActivityList activity={activity} members={members} stakeholders={stakeholders} accounts={accounts} />
        ) : (
          <Empty>No touches logged yet.</Empty>
        )}
      </Section>

      <Section label="Account">
        <form action={saveAccount.bind(null, account.id)} className="form-grid">
          <label className="field">
            <span className="mono-label">Company</span>
            <input name="company" defaultValue={account.company} required className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Website</span>
            <input name="website" defaultValue={account.website ?? ""} className="input" />
          </label>
          <MemberSelect members={members} name="ownerId" label="Owner" value={account.ownerId} />
          <label className="field">
            <span className="mono-label">Status</span>
            <select name="status" defaultValue={account.status} className="input">
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field form-wide">
            <span className="mono-label">Research notes</span>
            <textarea
              name="notes"
              rows={6}
              defaultValue={account.notes}
              placeholder="Product (3 likes, 2 friction points), story, funding, recent moments, people…"
              className="input"
            />
          </label>
          <div className="form-wide">
            <button type="submit" className="btn">
              Save
            </button>
          </div>
        </form>
      </Section>
    </Page>
  );
}

function StakeholderItem({ stakeholder: s, members }: { stakeholder: KamStakeholder; members: KamMember[] }) {
  const owner = members.find((m) => m.id === s.ownerId)?.name;
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={s.stage === "call_booked" ? "neutral" : "accent"}>{KAM_STAGE_LABELS[s.stage]}</Tag>
        {s.leadId && (
          <Link href={`/dashboard/leads/${s.leadId}`} className="action">
            Pipeline lead
            <Icon name="next" />
          </Link>
        )}
      </div>
      <p className="item-title m-0 mt-3">{s.name}</p>
      <p className="m-0 mt-1 text-[0.92rem] text-muted">
        {[s.role, owner, s.lastTouchAt ? `last touch ${formatYmd(s.lastTouchAt.slice(0, 10))}` : "no touches yet"].filter(Boolean).join(" · ")}
        {s.linkedinUrl && (
          <>
            {" · "}
            <a href={s.linkedinUrl} target="_blank" rel="noopener noreferrer" className="link">
              LinkedIn
            </a>
          </>
        )}
        {s.xUrl && (
          <>
            {" · "}
            <a href={s.xUrl} target="_blank" rel="noopener noreferrer" className="link">
              X
            </a>
          </>
        )}
      </p>
      <details className="mt-3">
        <summary className="mono-label cursor-pointer hover:text-text">Edit</summary>
        <form action={saveStakeholder.bind(null, s.id)} className="form-grid mt-4">
          <label className="field">
            <span className="mono-label">Stage</span>
            <select name="stage" defaultValue={s.stage} className="input">
              {KAM_STAGES.map((st) => (
                <option key={st} value={st}>
                  {KAM_STAGE_LABELS[st]}
                </option>
              ))}
            </select>
          </label>
          <MemberSelect members={members} name="ownerId" label="Owner" value={s.ownerId} />
          <label className="field">
            <span className="mono-label">Name</span>
            <input name="name" defaultValue={s.name} required className="input" />
          </label>
          <label className="field">
            <span className="mono-label">Role</span>
            <input name="role" defaultValue={s.role ?? ""} className="input" />
          </label>
          <label className="field">
            <span className="mono-label">LinkedIn URL</span>
            <input name="linkedinUrl" defaultValue={s.linkedinUrl ?? ""} className="input" />
          </label>
          <label className="field">
            <span className="mono-label">X URL</span>
            <input name="xUrl" defaultValue={s.xUrl ?? ""} className="input" />
          </label>
          <label className="field form-wide">
            <span className="mono-label">Notes</span>
            <textarea name="notes" rows={3} defaultValue={s.notes} placeholder="What they post about, tone, interests…" className="input" />
          </label>
          <div className="form-wide">
            <button type="submit" className="btn">
              Save
            </button>
            <p className="hint m-0 mt-2">Setting Call booked adds them to the pipeline with Source = KAM.</p>
          </div>
        </form>
      </details>
    </div>
  );
}
