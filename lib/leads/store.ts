import "server-only";

import { supabase } from "@/lib/supabase";
import { companyDomain, normaliseEmail, normaliseLinkedIn, pickMatch, type MatchedOn, type Signal } from "./dedup";
import {
  EXIT_STAGES,
  STAGE_LABELS,
  type DealType,
  type IcpFit,
  type Lead,
  type LeadActivity,
  type Origin,
  type Stage,
} from "./types";

/** Lead storage: tables `leads` and `lead_activity` (supabase/migrations/009_gtm_leads.sql). */

interface LeadRow {
  id: string;
  contact_name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  domain: string | null;
  funding_stage: string | null;
  icp_fit: IcpFit | null;
  origin: Origin;
  origin_detail: string | null;
  booking_source: string | null;
  owner: string | null;
  stage: Stage;
  stage_changed_at: string | null;
  exit_reason: string | null;
  deal_type: DealType;
  parent_lead_id: string | null;
  estimated_price: number | string | null;
  closed_price: number | string | null;
  next_action: string | null;
  next_action_due: string | null;
  last_touch_at: string | null;
  proposal_url: string | null;
  transcript_url: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

// Postgres numerics can arrive as strings.
const num = (v: number | string | null) => (v == null ? null : Number(v));

function fromRow(r: LeadRow): Lead {
  return {
    id: r.id,
    contactName: r.contact_name,
    company: r.company,
    role: r.role,
    email: r.email,
    linkedinUrl: r.linkedin_url,
    domain: r.domain,
    fundingStage: r.funding_stage,
    icpFit: r.icp_fit,
    origin: r.origin,
    originDetail: r.origin_detail,
    bookingSource: r.booking_source,
    owner: r.owner,
    stage: r.stage,
    stageChangedAt: r.stage_changed_at,
    exitReason: r.exit_reason,
    dealType: r.deal_type,
    parentLeadId: r.parent_lead_id,
    estimatedPrice: num(r.estimated_price),
    closedPrice: num(r.closed_price),
    nextAction: r.next_action,
    nextActionDue: r.next_action_due,
    lastTouchAt: r.last_touch_at,
    proposalUrl: r.proposal_url,
    transcriptUrl: r.transcript_url,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Lead fields that can be edited from the dashboard (stage has its own function). */
export interface LeadFields {
  contactName: string;
  company: string | null;
  role: string | null;
  email: string | null;
  linkedinUrl: string | null;
  fundingStage: string | null;
  icpFit: IcpFit | null;
  origin: Origin;
  originDetail: string | null;
  bookingSource: string | null;
  owner: string | null;
  dealType: DealType;
  estimatedPrice: number | null;
  closedPrice: number | null;
  nextAction: string | null;
  nextActionDue: string | null;
  proposalUrl: string | null;
  transcriptUrl: string | null;
  notes: string;
}

function toColumns(f: Partial<LeadFields>, website?: string | null): Partial<LeadRow> {
  const c: Partial<LeadRow> = {};
  if (f.contactName !== undefined) c.contact_name = f.contactName;
  if (f.company !== undefined) c.company = f.company;
  if (f.role !== undefined) c.role = f.role;
  if (f.email !== undefined) {
    c.email = normaliseEmail(f.email) ?? (f.email?.trim() || null);
    // Keep the domain in step with the email; a website can fill it for free-mail addresses.
    c.domain = companyDomain(f.email, website);
  }
  if (f.linkedinUrl !== undefined) c.linkedin_url = normaliseLinkedIn(f.linkedinUrl) ?? (f.linkedinUrl?.trim() || null);
  if (f.fundingStage !== undefined) c.funding_stage = f.fundingStage;
  if (f.icpFit !== undefined) c.icp_fit = f.icpFit;
  if (f.origin !== undefined) c.origin = f.origin;
  if (f.originDetail !== undefined) c.origin_detail = f.originDetail;
  if (f.bookingSource !== undefined) c.booking_source = f.bookingSource;
  if (f.owner !== undefined) c.owner = f.owner;
  if (f.dealType !== undefined) c.deal_type = f.dealType;
  if (f.estimatedPrice !== undefined) c.estimated_price = f.estimatedPrice;
  if (f.closedPrice !== undefined) c.closed_price = f.closedPrice;
  if (f.nextAction !== undefined) c.next_action = f.nextAction;
  if (f.nextActionDue !== undefined) c.next_action_due = f.nextActionDue;
  if (f.proposalUrl !== undefined) c.proposal_url = f.proposalUrl;
  if (f.transcriptUrl !== undefined) c.transcript_url = f.transcriptUrl;
  if (f.notes !== undefined) c.notes = f.notes;
  return c;
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`Supabase: could not ${action}: ${error.message}`);
}

export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabase().from("leads").select("*").order("updated_at", { ascending: false });
  if (error) fail("list leads", error);
  return (data as LeadRow[]).map(fromRow);
}

export async function getLead(id: string): Promise<Lead | null> {
  // Not a uuid: no such lead (and Postgres would reject the query).
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase().from("leads").select("*").eq("id", id).maybeSingle();
  if (error) fail("load lead", error);
  return data ? fromRow(data as LeadRow) : null;
}

export async function listActivity(leadId: string): Promise<LeadActivity[]> {
  const { data, error } = await supabase()
    .from("lead_activity")
    .select("*")
    .eq("lead_id", leadId)
    .order("at", { ascending: false });
  if (error) fail("load lead activity", error);
  return (data as { id: number; lead_id: string; type: string; detail: string | null; at: string }[]).map((a) => ({
    id: a.id,
    leadId: a.lead_id,
    type: a.type,
    detail: a.detail,
    at: a.at,
  }));
}

/**
 * Adds to the lead's timeline. `touch` marks a two-way contact (a DM, email, call, reply), which
 * moves "last touch" forward; notes and stage changes don't.
 */
export async function logActivity(
  leadId: string,
  type: string,
  detail: string | null,
  opts: { at?: string; touch?: boolean } = {},
): Promise<void> {
  const at = opts.at ?? new Date().toISOString();
  const { error } = await supabase().from("lead_activity").insert({ lead_id: leadId, type, detail, at });
  if (error) fail("log lead activity", error);
  if (opts.touch) await touchLead(leadId, at);
}

/** Moves last touch forward to `at` (never back). */
export async function touchLead(leadId: string, at: string): Promise<void> {
  const { error } = await supabase()
    .from("leads")
    .update({ last_touch_at: at })
    .eq("id", leadId)
    .or(`last_touch_at.is.null,last_touch_at.lt."${at}"`);
  if (error) fail("update last touch", error);
}

export async function createLead(
  fields: Partial<LeadFields> & { origin: Origin },
  opts: { stage?: Stage; website?: string | null; parentLeadId?: string; activity?: string; at?: string } = {},
): Promise<Lead> {
  const at = opts.at ?? new Date().toISOString();
  const stage = opts.stage ?? "engaged";
  const { data, error } = await supabase()
    .from("leads")
    .insert({
      ...toColumns({ contactName: "", ...fields }, opts.website),
      stage,
      stage_changed_at: at,
      last_touch_at: at,
      parent_lead_id: opts.parentLeadId ?? null,
      created_at: at,
    })
    .select("*")
    .single();
  if (error) fail("create lead", error);
  const lead = fromRow(data as LeadRow);
  await logActivity(lead.id, "created", opts.activity ?? `Added at ${STAGE_LABELS[stage]}`, { at });
  return lead;
}

export async function updateLead(id: string, fields: Partial<LeadFields>): Promise<void> {
  const columns = toColumns(fields);
  if (!Object.keys(columns).length) return;
  const { error } = await supabase().from("leads").update(columns).eq("id", id);
  if (error) fail("update lead", error);
}

export class StageError extends Error {}

/** Moves a lead to a stage. Lost and nurture need a reason. Returns false if nothing changed. */
export async function setStage(id: string, stage: Stage, opts: { reason?: string | null; by?: string } = {}) {
  const reason = opts.reason?.trim() || null;
  if (EXIT_STAGES.includes(stage) && !reason) throw new StageError(`Moving to ${STAGE_LABELS[stage]} needs a reason.`);

  const lead = await getLead(id);
  if (!lead) throw new StageError("Lead not found.");
  if (lead.stage === stage && (!reason || reason === lead.exitReason)) return false;

  const { error } = await supabase()
    .from("leads")
    .update({
      stage,
      stage_changed_at: new Date().toISOString(),
      // The reason belongs to the exit; clear it when the deal comes back.
      exit_reason: EXIT_STAGES.includes(stage) ? reason : null,
    })
    .eq("id", id);
  if (error) fail("update stage", error);

  const detail = `${STAGE_LABELS[lead.stage]} → ${STAGE_LABELS[stage]}${reason ? `: ${reason}` : ""}${opts.by ? ` (${opts.by})` : ""}`;
  await logActivity(id, "stage_changed", detail);
  return true;
}

/**
 * The lead a new signal belongs to, if any. Won and paid leads don't take new signals: a new
 * conversation after a win is a new deal.
 */
export async function findMatchingLead(signal: Signal): Promise<{ lead: Lead; on: MatchedOn } | null> {
  const email = normaliseEmail(signal.email);
  const linkedin = normaliseLinkedIn(signal.linkedinUrl);
  const domain = signal.domain?.toLowerCase() || null;
  const filters = [
    // ilike without wildcards is a case-insensitive equals; pickMatch re-checks exactly.
    email ? `email.ilike."${email.replace(/"/g, "")}"` : null,
    linkedin ? `linkedin_url.eq."${linkedin.replace(/"/g, "")}"` : null,
    domain ? `domain.eq."${domain.replace(/"/g, "")}"` : null,
  ].filter(Boolean);
  if (!filters.length) return null;

  const { data, error } = await supabase()
    .from("leads")
    .select("*")
    .not("stage", "in", "(won,paid)")
    .or(filters.join(","));
  if (error) fail("look up matching leads", error);
  const match = pickMatch({ email, linkedinUrl: linkedin, domain }, (data as LeadRow[]).map(fromRow));
  return match;
}

/** Creates the Project deal that follows a paid audit, linked back to it. */
export async function spawnProjectDeal(auditId: string): Promise<Lead> {
  const audit = await getLead(auditId);
  if (!audit) throw new StageError("Lead not found.");
  if (audit.dealType !== "audit") throw new StageError("Only audit deals spawn a project deal.");
  const project = await createLead(
    {
      contactName: audit.contactName,
      company: audit.company,
      role: audit.role,
      email: audit.email,
      linkedinUrl: audit.linkedinUrl,
      fundingStage: audit.fundingStage,
      icpFit: audit.icpFit,
      // Credit the channel that brought the audit in.
      origin: audit.origin,
      originDetail: audit.originDetail,
      bookingSource: audit.bookingSource,
      owner: audit.owner,
      dealType: "project",
    },
    // The audit's domain stands in for a website, for free-mail addresses.
    { stage: "engaged", parentLeadId: audit.id, website: audit.domain, activity: "Project deal after the audit" },
  );
  await logActivity(audit.id, "project_spawned", project.id);
  return project;
}

/** Project deals spawned from this audit. */
export async function childLeads(parentId: string): Promise<Lead[]> {
  const { data, error } = await supabase().from("leads").select("*").eq("parent_lead_id", parentId);
  if (error) fail("load project deals", error);
  return (data as LeadRow[]).map(fromRow);
}
