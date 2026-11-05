/**
 * X leads: people found by social listening on X, loaded by the GTM bot with origin = x_outreach
 * and origin_detail "<source>:@handle" (for example "lead_radar:@jane" or "dm_pipeline:@jane").
 */

import { STAGES, type Lead, type Stage } from "./types";

export const X_SOURCES = ["lead_radar", "dm_pipeline"] as const;
export type XSource = (typeof X_SOURCES)[number];

export const X_SOURCE_LABELS: Record<XSource, string> = {
  lead_radar: "Lead Radar",
  dm_pipeline: "DM pipeline",
};

const DAY_MS = 86_400_000;

/** "lead_radar:@Jane_Doe" → { source: "lead_radar", handle: "Jane_Doe" }. Unknown parts are null. */
export function parseXOrigin(detail: string | null | undefined): { source: XSource | null; handle: string | null } {
  const m = detail?.trim().match(/^([a-z_]+)\s*:\s*@?([A-Za-z0-9_]{1,15})\b/i);
  if (!m) return { source: null, handle: null };
  const source = m[1].toLowerCase();
  return { source: (X_SOURCES as readonly string[]).includes(source) ? (source as XSource) : null, handle: m[2] };
}

/**
 * The X profile picture for a handle, via unavatar.io (no X API key needed). It follows the
 * current picture, and returns a generic avatar when the account has none or doesn't exist.
 */
export function xAvatarUrl(handle: string) {
  return `https://unavatar.io/x/${encodeURIComponent(handle)}`;
}

export interface XLead {
  lead: Lead;
  source: XSource | null;
  handle: string | null;
}

export interface XLeadFilters {
  q: string;
  source: string;
  stage: string;
}

export function toXLeads(leads: Lead[]): XLead[] {
  return leads.filter((l) => l.origin === "x_outreach").map((lead) => ({ lead, ...parseXOrigin(lead.originDetail) }));
}

/** Filters by source, stage and a search over name, company and handle; newest touch first. */
export function filterXLeads(rows: XLead[], filters: XLeadFilters): XLead[] {
  const q = filters.q.trim().toLowerCase().replace(/^@/, "");
  return rows
    .filter((r) => {
      if (filters.source !== "all" && r.source !== filters.source) return false;
      if (filters.stage !== "all" && r.lead.stage !== filters.stage) return false;
      if (!q) return true;
      return [r.lead.contactName, r.lead.company, r.handle].filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => sortKey(b.lead) - sortKey(a.lead));
}

/** Last touch, then created, so leads nobody has touched still sort sensibly. */
function sortKey(lead: Lead) {
  return Date.parse(lead.lastTouchAt ?? lead.createdAt) || 0;
}

/** Total, count per stage (only stages that have leads, in pipeline order) and added in the last 7 days. */
export function summariseXLeads(rows: XLead[], now: number) {
  const byStage = STAGES.map((stage) => ({ stage, count: rows.filter((r) => r.lead.stage === stage).length })).filter(
    (s) => s.count > 0,
  ) as { stage: Stage; count: number }[];
  return {
    total: rows.length,
    byStage,
    lastWeek: rows.filter((r) => Date.parse(r.lead.createdAt) > now - 7 * DAY_MS).length,
  };
}
