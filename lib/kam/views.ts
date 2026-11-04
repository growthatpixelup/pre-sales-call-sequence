import "server-only";

import { dashboardTimeZone } from "@/lib/analytics";
import { addDays, localDate } from "@/lib/emails/time";
import { listLeads } from "@/lib/leads/store";
import { WON_STAGES, type Lead } from "@/lib/leads/types";
import { listAccounts, listActivity, listMembers, listStakeholders, listUnmatched } from "./store";
import { touchesBeforeReply } from "./metrics";
import { COLD_DAYS, DAILY_TARGETS, isEngagement, type KamActivity, type KamStakeholder } from "./types";

const DAY_MS = 86_400_000;

export interface MemberDay {
  engagement: number;
  dms: number;
  other: number;
}

const emptyDay = (): MemberDay => ({ engagement: 0, dms: 0, other: 0 });

function tally(list: KamActivity[]): MemberDay {
  const d = emptyDay();
  for (const a of list) {
    if (isEngagement(a.type)) d.engagement += a.count;
    else if (a.type === "dm") d.dms += a.count;
    else d.other += a.count;
  }
  return d;
}

/** Today vs targets, and the last 7 days, per active member. */
export async function loadTeam(now: Date) {
  const tz = dashboardTimeZone();
  const today = localDate(now, tz);
  const weekStart = addDays(today, -6);
  const [members, activity, unmatched, stakeholders, accounts] = await Promise.all([
    listMembers(),
    listActivity({ since: weekStart }),
    listUnmatched(),
    listStakeholders(),
    listAccounts(),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const team = members
    .filter((m) => m.active)
    .map((member) => {
      const mine = activity.filter((a) => a.memberId === member.id);
      const todayTally = tally(mine.filter((a) => a.day === today));
      return {
        member,
        today: todayTally,
        behind: todayTally.engagement < DAILY_TARGETS.engagement.min || todayTally.dms < DAILY_TARGETS.dms.min,
        week: days.map((day) => ({ day, ...tally(mine.filter((a) => a.day === day)) })),
        weekTotal: tally(mine),
      };
    });

  const activeAccounts = new Set(accounts.filter((a) => a.status === "active").map((a) => a.id));
  const cold = stakeholders
    .filter((s) => activeAccounts.has(s.accountId) && s.stage !== "call_booked")
    .filter((s) => now.getTime() - Date.parse(s.lastTouchAt ?? s.createdAt) >= COLD_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(a.lastTouchAt ?? a.createdAt) - Date.parse(b.lastTouchAt ?? b.createdAt));

  return { today, days, team, unmatched, cold, recent: activity.slice(0, 40), members, accounts, stakeholders };
}

export interface KamWin {
  lead: Lead;
  stakeholder: KamStakeholder | null;
  /** First KAM touch on the stakeholder to the deal being signed. */
  daysToClose: number | null;
  /** Touches before their first reply. */
  touchesBeforeReply: number | null;
}

/**
 * KAM deals: pipeline leads with origin KAM, or linked to a KAM stakeholder. Won and paid ones
 * count as wins.
 */
export async function loadWins() {
  const [leads, stakeholders, activity, members, accounts] = await Promise.all([
    listLeads(),
    listStakeholders(),
    listActivity({ limit: 20000 }),
    listMembers(),
    listAccounts(),
  ]);
  const byLead = new Map(stakeholders.filter((s) => s.leadId).map((s) => [s.leadId!, s]));
  const deals = leads.filter((l) => l.origin === "kam" || byLead.has(l.id));

  const rows: KamWin[] = deals.map((lead) => {
    const stakeholder = byLead.get(lead.id) ?? null;
    const touches = stakeholder ? activity.filter((a) => a.stakeholderId === stakeholder.id) : [];
    const first = touches.reduce<string | null>((min, a) => (!min || a.day < min ? a.day : min), null);
    const signed = WON_STAGES.includes(lead.stage) ? (lead.stageChangedAt ?? lead.updatedAt) : null;
    return {
      lead,
      stakeholder,
      daysToClose: first && signed ? Math.max(0, Math.round((Date.parse(signed) - Date.parse(`${first}T12:00:00Z`)) / DAY_MS)) : null,
      touchesBeforeReply: touches.length ? touchesBeforeReply(touches) : null,
    };
  });

  const won = rows.filter((r) => WON_STAGES.includes(r.lead.stage));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  // Touches before reply across every stakeholder who replied, not only wins.
  const replied = stakeholders
    .map((s) => touchesBeforeReply(activity.filter((a) => a.stakeholderId === s.id)))
    .filter((n): n is number => n != null);

  return {
    rows,
    stats: {
      revenue: won.reduce((n, r) => n + (r.lead.closedPrice ?? r.lead.estimatedPrice ?? 0), 0),
      won: won.length,
      open: rows.length - won.length - rows.filter((r) => r.lead.stage === "lost" || r.lead.stage === "nurture").length,
      avgDaysToClose: avg(won.map((r) => r.daysToClose).filter((n): n is number => n != null)),
      avgTouchesBeforeReply: avg(replied),
    },
    members,
    accounts,
  };
}
