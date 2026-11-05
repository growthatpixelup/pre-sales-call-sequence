/**
 * Pipeline maths for /dashboard/pipeline. Pure: callers pass leads, their bookings and the time.
 *
 * A lead's value is its closed price, else its estimate, else the midpoint of the investment range
 * they gave when booking. "Reached" a stage means the lead is at that stage or further on.
 */

import { estimatedValue } from "@/lib/analytics";
import type { Booking } from "@/lib/bookings/types";
import { ORIGINS, STAGE_RANK, WON_STAGES, type Lead, type Origin, type Stage } from "./types";

export const PIPELINE_PERIODS = [
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "12m", label: "12 months", days: 365 },
  { value: "all", label: "All time", days: null },
] as const;
export type PipelinePeriod = (typeof PIPELINE_PERIODS)[number]["value"];
export const DEFAULT_PIPELINE_PERIOD: PipelinePeriod = "90d";

/** The forward path, in order. Exits (lost, nurture) and no-show are counted separately. */
export const FUNNEL: Stage[] = ["engaged", "call_booked", "call_held", "proposal_sent", "negotiating", "won", "paid"];

export type CallState = "upcoming" | "done" | "cancelled";

export interface PipelineLead {
  lead: Lead;
  /** Closed price, estimate, or investment-range midpoint; null with nothing to go on. */
  value: number | null;
  valueKind: "closed" | "estimate" | "range" | null;
  /** The lead's latest call: the latest live booking, else the latest cancelled one. */
  call: { at: string; state: CallState } | null;
}

const DAY = 86_400_000;

export function enrichLeads(leads: Lead[], bookings: Booking[], now: number): PipelineLead[] {
  const byLead = new Map<string, Booking[]>();
  for (const b of bookings) if (b.leadId) byLead.set(b.leadId, [...(byLead.get(b.leadId) ?? []), b]);
  return leads.map((lead) => {
    const list = (byLead.get(lead.id) ?? []).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
    const live = list.find((b) => b.bookingStatus === "accepted" || b.bookingStatus === "pending");
    const latest = live ?? list[0];
    const call: PipelineLead["call"] = latest
      ? { at: latest.startTime, state: !live ? "cancelled" : Date.parse(live.endTime) > now ? "upcoming" : "done" }
      : null;
    const range = list.map((b) => estimatedValue(b)).find((v) => v != null) ?? null;
    const [value, valueKind] =
      lead.closedPrice != null
        ? [lead.closedPrice, "closed" as const]
        : lead.estimatedPrice != null
          ? [lead.estimatedPrice, "estimate" as const]
          : range != null
            ? [range, "range" as const]
            : [null, null];
    return { lead, value, valueKind, call };
  });
}

export const reached = (stage: Stage, target: Stage) => STAGE_RANK[stage] >= STAGE_RANK[target];

export function inPeriod(p: PipelineLead, period: PipelinePeriod, now: number) {
  const days = PIPELINE_PERIODS.find((x) => x.value === period)?.days ?? null;
  return days == null || Date.parse(p.lead.createdAt) >= now - days * DAY;
}

export function buildPipeline(all: PipelineLead[], now: number) {
  const sum = (list: PipelineLead[]) => list.reduce((n, p) => n + (p.value ?? 0), 0);
  const at = (stage: Stage) => all.filter((p) => p.lead.stage === stage);

  const funnel = FUNNEL.map((stage) => {
    const here = at(stage);
    const atLeast = all.filter((p) => reached(p.lead.stage, stage));
    return { stage, count: here.length, value: sum(here), reached: atLeast.length };
  });
  const conversions = funnel.slice(1).map((s, i) => ({
    from: funnel[i].stage,
    to: s.stage,
    rate: funnel[i].reached ? s.reached / funnel[i].reached : null,
  }));

  const booked = at("call_booked");
  const needsOutcome = booked
    .filter((p) => p.call?.state === "done")
    .sort((a, b) => Date.parse(b.call!.at) - Date.parse(a.call!.at));
  const cancelled = booked.filter((p) => !p.call || p.call.state === "cancelled");
  const upcoming = booked
    .filter((p) => p.call?.state === "upcoming")
    .sort((a, b) => Date.parse(a.call!.at) - Date.parse(b.call!.at));

  const won = all.filter((p) => WON_STAGES.includes(p.lead.stage));
  const open = all.filter((p) => !WON_STAGES.includes(p.lead.stage) && p.lead.stage !== "lost" && p.lead.stage !== "nurture");
  const lost = all.filter((p) => p.lead.stage === "lost");
  const callsBooked = all.filter((p) => reached(p.lead.stage, "call_booked") || p.lead.stage === "no_show").length;

  const bySource = ORIGINS.map((origin: Origin) => {
    const mine = all.filter((p) => p.lead.origin === origin);
    const wonMine = mine.filter((p) => WON_STAGES.includes(p.lead.stage));
    return {
      origin,
      leads: mine.length,
      calls: mine.filter((p) => reached(p.lead.stage, "call_booked") || p.lead.stage === "no_show").length,
      held: mine.filter((p) => reached(p.lead.stage, "call_held")).length,
      won: wonMine.length,
      revenue: wonMine.reduce((n, p) => n + (p.lead.closedPrice ?? 0), 0),
      openValue: sum(mine.filter((p) => open.includes(p))),
    };
  }).filter((r) => r.leads > 0);

  // The last 12 calendar months, oldest first: leads created and deals won (by when they reached won).
  const months: { key: string; label: string; leads: number; won: number }[] = [];
  const d = new Date(now);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const key = m.toISOString().slice(0, 7);
    months.push({ key, label: m.toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }), leads: 0, won: 0 });
  }
  for (const p of all) {
    const created = months.find((m) => m.key === p.lead.createdAt.slice(0, 7));
    if (created) created.leads++;
    if (WON_STAGES.includes(p.lead.stage) && p.lead.stageChangedAt) {
      const wonIn = months.find((m) => m.key === p.lead.stageChangedAt!.slice(0, 7));
      if (wonIn) wonIn.won++;
    }
  }

  return {
    total: all.length,
    funnel,
    conversions,
    needsOutcome,
    cancelled,
    upcoming,
    noShow: at("no_show").length,
    lost: lost.length,
    nurture: at("nurture").length,
    open: { count: open.length, value: sum(open), ranged: open.filter((p) => p.valueKind === "range").length },
    won: { count: won.length, revenue: won.reduce((n, p) => n + (p.lead.closedPrice ?? 0), 0) },
    paid: at("paid").reduce((n, p) => n + (p.lead.closedPrice ?? 0), 0),
    callsBooked,
    /** Won ÷ (won + lost): of deals that ended, how many we won. */
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    /** Won ÷ calls booked. */
    callToWin: callsBooked ? won.length / callsBooked : null,
    bySource,
    months,
  };
}

export type PipelineView = ReturnType<typeof buildPipeline>;
