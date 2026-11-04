/**
 * GTM OS leads (supabase/migrations/009_gtm_leads.sql). A lead is one deal, from the first
 * two-way signal on any channel to paid. Cal.com bookings live in lib/bookings and point at a lead.
 */

/** Pipeline stages in order, then the two exits. */
export const STAGES = [
  "engaged",
  "call_booked",
  "call_held",
  "no_show",
  "proposal_sent",
  "negotiating",
  "won",
  "paid",
  "lost",
  "nurture",
] as const;
export type Stage = (typeof STAGES)[number];

export const EXIT_STAGES: Stage[] = ["lost", "nurture"];
/** Stages where the deal is still being worked. Won is signed but not yet paid, so still open. */
export const OPEN_STAGES: Stage[] = ["engaged", "call_booked", "call_held", "no_show", "proposal_sent", "negotiating", "won"];
/** Signed: counts as a win. */
export const WON_STAGES: Stage[] = ["won", "paid"];

export const STAGE_LABELS: Record<Stage, string> = {
  engaged: "Engaged",
  call_booked: "Call booked",
  call_held: "Call held",
  no_show: "No-show",
  proposal_sent: "Proposal sent",
  negotiating: "Negotiating",
  won: "Won",
  paid: "Paid",
  lost: "Lost",
  nurture: "Nurture",
};

/** How far along a stage is, for "only move forward" rules. Exits rank lowest. */
export const STAGE_RANK: Record<Stage, number> = {
  lost: 0,
  nurture: 1,
  engaged: 2,
  call_booked: 3,
  no_show: 4,
  call_held: 5,
  proposal_sent: 6,
  negotiating: 7,
  won: 8,
  paid: 9,
};

export const ORIGINS = [
  "cal",
  "contra",
  "outbound",
  "x_outreach",
  "founder_inbox",
  "kam",
  "inbound",
  "referral",
] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_LABELS: Record<Origin, string> = {
  cal: "Cal",
  contra: "Contra",
  outbound: "Outbound",
  x_outreach: "X outreach",
  founder_inbox: "Founder inbox",
  kam: "KAM",
  inbound: "Inbound",
  referral: "Referral program",
};

export const DEAL_TYPES = ["project", "audit"] as const;
export type DealType = (typeof DEAL_TYPES)[number];
export const DEAL_TYPE_LABELS: Record<DealType, string> = { project: "Project", audit: "Audit" };

export const ICP_FITS = ["strong", "medium", "weak"] as const;
export type IcpFit = (typeof ICP_FITS)[number];

/** Activity a person logs by hand on the lead page. */
export const MANUAL_ACTIVITY = ["note", "dm", "email", "call", "proposal"] as const;
export type ManualActivity = (typeof MANUAL_ACTIVITY)[number];
export const ACTIVITY_LABELS: Record<string, string> = {
  note: "Note",
  dm: "DM",
  email: "Email",
  call: "Call",
  proposal: "Proposal",
  created: "Lead created",
  stage_changed: "Stage changed",
  booking: "Call booked",
  project_spawned: "Project deal created",
};

export interface Lead {
  id: string;

  // Who
  contactName: string;
  company: string | null;
  role: string | null;
  email: string | null;
  linkedinUrl: string | null;
  domain: string | null;
  fundingStage: string | null;
  icpFit: IcpFit | null;

  // Origin
  origin: Origin;
  originDetail: string | null;
  bookingSource: string | null;
  owner: string | null;

  // Status
  stage: Stage;
  stageChangedAt: string | null;
  exitReason: string | null;
  dealType: DealType;
  parentLeadId: string | null;
  estimatedPrice: number | null;
  closedPrice: number | null;
  nextAction: string | null;
  /** "YYYY-MM-DD". */
  nextActionDue: string | null;
  lastTouchAt: string | null;

  // Context
  proposalUrl: string | null;
  transcriptUrl: string | null;
  notes: string;
  /** KAM wins: how we won it. */
  winNote: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  id: number;
  leadId: string;
  type: string;
  detail: string | null;
  at: string;
}

/** The closed price once agreed, else the estimate. */
export function leadValue(lead: Pick<Lead, "closedPrice" | "estimatedPrice">): number | null {
  return lead.closedPrice ?? lead.estimatedPrice;
}

export function isOpen(lead: Pick<Lead, "stage">) {
  return OPEN_STAGES.includes(lead.stage);
}

export function leadName(lead: Pick<Lead, "contactName" | "company" | "email">) {
  return lead.contactName || lead.company || lead.email || "Unnamed lead";
}
