import Link from "next/link";
import { formatYmd } from "@/lib/format";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  type KamAccount,
  type KamActivity,
  type KamMember,
  type KamStakeholder,
} from "@/lib/kam/types";
import { Tag } from "@/app/dashboard/_components/ui";
import { quickLog, removeActivity } from "../actions";

export function MemberSelect({ members, name = "memberId", value, label = "Who" }: { members: KamMember[]; name?: string; value?: string | null; label?: string }) {
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input">
        <option value="">—</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Stakeholders grouped by account. */
export function StakeholderSelect({
  stakeholders,
  accounts,
  name = "stakeholderId",
  label = "Stakeholder",
  required = false,
  first,
}: {
  stakeholders: KamStakeholder[];
  accounts: KamAccount[];
  name?: string;
  label?: string;
  required?: boolean;
  /** Shown first, e.g. suggested matches. */
  first?: KamStakeholder[];
}) {
  const companyOf = new Map(accounts.map((a) => [a.id, a.company]));
  return (
    <label className="field">
      <span className="mono-label">{label}</span>
      <select name={name} defaultValue={first?.[0]?.id ?? ""} required={required} className="input">
        <option value="">{required ? "Pick someone" : "Nobody in particular"}</option>
        {first && first.length > 0 && (
          <optgroup label="Suggested">
            {first.map((s) => (
              <option key={`f-${s.id}`} value={s.id}>
                {s.name} · {companyOf.get(s.accountId)}
              </option>
            ))}
          </optgroup>
        )}
        {accounts.map((a) => {
          const people = stakeholders.filter((s) => s.accountId === a.id);
          if (!people.length) return null;
          return (
            <optgroup key={a.id} label={a.company}>
              {people.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}

/** The seconds-long log: pick who, what, and (optionally) about whom. */
export function QuickLogForm({
  members,
  stakeholders,
  accounts,
  memberId,
}: {
  members: KamMember[];
  stakeholders: KamStakeholder[];
  accounts: KamAccount[];
  /** Pre-selects who's logging (member pages). */
  memberId?: string;
}) {
  return (
    <form action={quickLog} className="form-grid">
      <MemberSelect members={members} value={memberId} />
      <label className="field">
        <span className="mono-label">What</span>
        <select name="type" defaultValue="comment" className="input">
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <StakeholderSelect stakeholders={stakeholders} accounts={accounts} />
      <label className="field">
        <span className="mono-label">Where</span>
        <select name="platform" defaultValue="linkedin" className="input">
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="mono-label">How many</span>
        <input name="count" type="number" min={1} defaultValue={1} className="input tabular-nums" />
      </label>
      <label className="field">
        <span className="mono-label">Link</span>
        <input name="link" type="url" placeholder="Post or profile" className="input" />
      </label>
      <label className="field form-wide">
        <span className="mono-label">Note</span>
        <input name="note" placeholder="Optional" className="input" />
      </label>
      <div className="form-wide">
        <button type="submit" className="btn">
          Log it
        </button>
      </div>
    </form>
  );
}

/** A list of touches, newest first. */
export function ActivityList({
  activity,
  members,
  stakeholders,
  accounts,
  showDelete = true,
}: {
  activity: KamActivity[];
  members: KamMember[];
  stakeholders: KamStakeholder[];
  accounts: KamAccount[];
  showDelete?: boolean;
}) {
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const person = new Map(stakeholders.map((s) => [s.id, s]));
  const company = new Map(accounts.map((a) => [a.id, a.company]));
  return (
    <ul className="list">
      {activity.map((a) => {
        const s = a.stakeholderId ? person.get(a.stakeholderId) : null;
        const who = s?.name ?? a.personName;
        const where = a.accountId ? company.get(a.accountId) : a.companyName;
        return (
          <li key={a.id}>
            <div className="item">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone="neutral">
                    {ACTIVITY_TYPE_LABELS[a.type]}
                    {a.count > 1 ? ` ×${a.count}` : ""}
                  </Tag>
                  {!s && a.personName && !a.reviewed && <Tag>Unmatched</Tag>}
                  {a.source === "slack" && <Tag tone="muted">Slack</Tag>}
                </div>
                <p className="m-0 mt-2">
                  {who ?? <span className="text-muted">No one named</span>}
                  {where && (
                    <span className="text-muted">
                      {" · "}
                      {a.accountId ? (
                        <Link href={`/dashboard/kam/accounts/${a.accountId}`} className="link">
                          {where}
                        </Link>
                      ) : (
                        where
                      )}
                    </span>
                  )}
                </p>
                <p className="hint m-0 mt-1">
                  {formatYmd(a.day)} · {(a.memberId && memberName.get(a.memberId)) ?? "Unknown"} · {PLATFORM_LABELS[a.platform]}
                  {a.note ? ` · ${a.note}` : ""}
                </p>
              </div>
              <div className="item-actions">
                {a.link && (
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="action">
                    Open
                  </a>
                )}
                {showDelete && (
                  <form action={removeActivity.bind(null, a.id)}>
                    <button type="submit" className="action">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
