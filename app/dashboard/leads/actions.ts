"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { companyDomain } from "@/lib/leads/dedup";
import {
  StageError,
  createLead,
  findMatchingLead,
  logActivity,
  setStage,
  spawnProjectDeal,
  updateLead,
  type LeadFields,
} from "@/lib/leads/store";
import {
  DEAL_TYPES,
  ICP_FITS,
  MANUAL_ACTIVITY,
  ORIGINS,
  STAGES,
  type DealType,
  type IcpFit,
  type ManualActivity,
  type Origin,
  type Stage,
} from "@/lib/leads/types";

// Pipeline (lead) actions. Like every /dashboard route, these sit behind proxy.ts.

const text = (formData: FormData, key: string): string | null => {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
}

function money(formData: FormData, key: string): number | null {
  const raw = text(formData, key)?.replace(/[$,\s]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid amount for ${key}`);
  return value;
}

export type ActionResult = { ok: true } | { ok: false, error: string };

/** Moves a lead to a stage. Used by the Pipeline board; Lost and Nurture need a reason. */
export async function moveStage(leadId: string, stage: string, reason?: string): Promise<ActionResult> {
  const target = oneOf<Stage>(STAGES, stage);
  if (!target) return { ok: false, error: "Unknown stage." };
  try {
    await setStage(leadId, target, { reason });
  } catch (err) {
    if (err instanceof StageError) return { ok: false, error: err.message };
    throw err;
  }
  refresh();
  return { ok: true };
}

/** The stage form on lead and booking pages (stage, plus a reason for Lost / Nurture). */
export async function updateLeadStage(leadId: string, formData: FormData) {
  const stage = oneOf<Stage>(STAGES, formData.get("stage"));
  if (!stage) throw new Error("Invalid stage");
  await setStage(leadId, stage, { reason: text(formData, "reason") });
  refresh();
}

function fieldsFrom(formData: FormData): Partial<LeadFields> {
  const fields: Partial<LeadFields> = {};
  // Only fields present in the form are changed.
  const has = (key: string) => formData.has(key);
  if (has("contactName")) fields.contactName = text(formData, "contactName") ?? "";
  if (has("company")) fields.company = text(formData, "company");
  if (has("role")) fields.role = text(formData, "role");
  if (has("email")) fields.email = text(formData, "email");
  if (has("linkedinUrl")) fields.linkedinUrl = text(formData, "linkedinUrl");
  if (has("fundingStage")) fields.fundingStage = text(formData, "fundingStage");
  if (has("icpFit")) fields.icpFit = oneOf<IcpFit>(ICP_FITS, formData.get("icpFit"));
  if (has("origin")) {
    const origin = oneOf<Origin>(ORIGINS, formData.get("origin"));
    if (origin) fields.origin = origin;
  }
  if (has("originDetail")) fields.originDetail = text(formData, "originDetail");
  if (has("bookingSource")) fields.bookingSource = text(formData, "bookingSource");
  if (has("owner")) fields.owner = text(formData, "owner");
  if (has("dealType")) {
    const dealType = oneOf<DealType>(DEAL_TYPES, formData.get("dealType"));
    if (dealType) fields.dealType = dealType;
  }
  if (has("estimatedPrice")) fields.estimatedPrice = money(formData, "estimatedPrice");
  if (has("closedPrice")) fields.closedPrice = money(formData, "closedPrice");
  if (has("nextAction")) fields.nextAction = text(formData, "nextAction");
  if (has("nextActionDue")) {
    const due = text(formData, "nextActionDue");
    fields.nextActionDue = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
  }
  if (has("proposalUrl")) fields.proposalUrl = text(formData, "proposalUrl");
  if (has("transcriptUrl")) fields.transcriptUrl = text(formData, "transcriptUrl");
  if (has("notes")) fields.notes = text(formData, "notes") ?? "";
  return fields;
}

/** Saves whichever lead fields the submitted form carries. */
export async function saveLead(leadId: string, formData: FormData) {
  await updateLead(leadId, fieldsFrom(formData));
  refresh();
}

/** Logs a DM, email, call, proposal or note on the lead's timeline. */
export async function addActivity(leadId: string, formData: FormData) {
  const type = oneOf<ManualActivity>(MANUAL_ACTIVITY, formData.get("type")) ?? "note";
  const detail = text(formData, "detail");
  if (!detail) return;
  const date = text(formData, "date");
  // A date picked in the form is logged at midday, so it lands on that day in any time zone.
  const at = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`).toISOString() : undefined;
  await logActivity(leadId, type, detail, { at, touch: type !== "note" });
  refresh();
}

/**
 * Quick add: a lead from a DM, email or any channel without a feed yet. If they match an open
 * lead (email, LinkedIn URL, then domain) nothing is created and that lead opens instead.
 */
export async function addLead(formData: FormData) {
  const fields = fieldsFrom(formData);
  const origin = oneOf<Origin>(ORIGINS, formData.get("origin"));
  if (!origin) throw new Error("Pick where this lead came from.");
  if (!fields.contactName && !fields.company && !fields.email) throw new Error("Add a name, company or email.");
  const website = text(formData, "website");

  const match = await findMatchingLead({
    email: fields.email,
    linkedinUrl: fields.linkedinUrl,
    domain: companyDomain(fields.email, website),
  });
  if (match) {
    const detail = text(formData, "firstTouch");
    await logActivity(match.lead.id, "note", `Quick add matched this lead on ${match.on}${detail ? `: ${detail}` : ""}`);
    redirect(`/dashboard/leads/${match.lead.id}?matched=${match.on}`);
  }

  const lead = await createLead({ ...fields, origin }, { website, activity: text(formData, "firstTouch") ?? undefined });
  redirect(`/dashboard/leads/${lead.id}`);
}

export async function startProjectDeal(auditId: string) {
  const project = await spawnProjectDeal(auditId);
  redirect(`/dashboard/leads/${project.id}`);
}
