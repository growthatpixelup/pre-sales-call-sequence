"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { dashboardTimeZone } from "@/lib/analytics";
import { localDate } from "@/lib/emails/time";
import { attribute, bookCall, unattribute } from "@/lib/kam/leads";
import {
  addMember,
  assignActivity,
  createAccount,
  createStakeholder,
  deleteActivity,
  dismissActivity,
  getStakeholder,
  logActivities,
  updateAccount,
  updateStakeholder,
} from "@/lib/kam/store";
import { retryFailed, syncKamSlack } from "@/lib/kam/sync";
import {
  ACCOUNT_STATUSES,
  ACTIVITY_TYPES,
  KAM_STAGES,
  PLATFORMS,
  type AccountStatus,
  type ActivityType,
  type KamStage,
  type Platform,
} from "@/lib/kam/types";
import { hostOf } from "@/lib/leads/dedup";
import { updateLead } from "@/lib/leads/store";

// KAM actions. Like every /dashboard route, these sit behind proxy.ts.

const text = (formData: FormData, key: string): string | null => {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
}

export async function addAccount(formData: FormData) {
  const company = text(formData, "company");
  if (!company) throw new Error("Add the company name.");
  const website = text(formData, "website");
  const account = await createAccount({
    company,
    website,
    domain: hostOf(website),
    ownerId: text(formData, "ownerId"),
  });
  redirect(`/dashboard/kam/accounts/${account.id}`);
}

export async function saveAccount(accountId: string, formData: FormData) {
  const website = text(formData, "website");
  await updateAccount(accountId, {
    ...(formData.has("company") ? { company: text(formData, "company") ?? "" } : {}),
    ...(formData.has("website") ? { website, domain: hostOf(website) } : {}),
    ...(formData.has("ownerId") ? { ownerId: text(formData, "ownerId") } : {}),
    ...(formData.has("status") ? { status: oneOf<AccountStatus>(ACCOUNT_STATUSES, formData.get("status")) ?? "active" } : {}),
    ...(formData.has("notes") ? { notes: text(formData, "notes") ?? "" } : {}),
  });
  refresh();
}

export async function addStakeholder(accountId: string, formData: FormData) {
  const name = text(formData, "name");
  if (!name) throw new Error("Add their name.");
  await createStakeholder({
    accountId,
    name,
    role: text(formData, "role"),
    linkedinUrl: text(formData, "linkedinUrl"),
    xUrl: text(formData, "xUrl"),
    ownerId: text(formData, "ownerId"),
  });
  refresh();
}

export async function saveStakeholder(stakeholderId: string, formData: FormData) {
  const stage = oneOf<KamStage>(KAM_STAGES, formData.get("stage"));
  // Call booked also puts them in the pipeline.
  if (stage === "call_booked") {
    const current = await getStakeholder(stakeholderId);
    if (current?.stage !== "call_booked") await bookCall(stakeholderId);
  }
  await updateStakeholder(stakeholderId, {
    ...(formData.has("name") ? { name: text(formData, "name") ?? "" } : {}),
    ...(formData.has("role") ? { role: text(formData, "role") } : {}),
    ...(formData.has("linkedinUrl") ? { linkedinUrl: text(formData, "linkedinUrl") } : {}),
    ...(formData.has("xUrl") ? { xUrl: text(formData, "xUrl") } : {}),
    ...(formData.has("ownerId") ? { ownerId: text(formData, "ownerId") } : {}),
    ...(formData.has("notes") ? { notes: text(formData, "notes") ?? "" } : {}),
    ...(stage && stage !== "call_booked" ? { stage } : {}),
  });
  refresh();
}

/** The seconds-long quick log: one touch, or a batch of unnamed likes/comments. */
export async function quickLog(formData: FormData) {
  const type = oneOf<ActivityType>(ACTIVITY_TYPES, formData.get("type"));
  if (!type) throw new Error("Pick what you did.");
  const stakeholderId = text(formData, "stakeholderId");
  const stakeholder = stakeholderId ? await getStakeholder(stakeholderId) : null;
  const count = Number(text(formData, "count") ?? "1");
  const day = text(formData, "day");
  await logActivities([
    {
      day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : localDate(new Date(), dashboardTimeZone()),
      memberId: text(formData, "memberId"),
      accountId: stakeholder?.accountId ?? text(formData, "accountId"),
      stakeholderId: stakeholder?.id ?? null,
      type,
      platform: oneOf<Platform>(PLATFORMS, formData.get("platform")) ?? "linkedin",
      count: Number.isFinite(count) && count > 0 ? count : 1,
      link: text(formData, "link"),
      note: text(formData, "note"),
      source: "manual",
    },
  ]);
  refresh();
}

export async function removeActivity(activityId: number) {
  await deleteActivity(activityId);
  refresh();
}

/** Review: the touch was about this existing stakeholder. */
export async function assignTouch(activityId: number, formData: FormData) {
  const stakeholder = await getStakeholder(text(formData, "stakeholderId") ?? "");
  if (!stakeholder) throw new Error("Pick a stakeholder.");
  await assignActivity(activityId, stakeholder);
  refresh();
}

/** Review: the touch was about someone new; add them (to an existing or new account) and assign it. */
export async function createFromTouch(activityId: number, formData: FormData) {
  const name = text(formData, "name");
  if (!name) throw new Error("Add their name.");
  let accountId = text(formData, "accountId");
  if (!accountId || accountId === "new") {
    const company = text(formData, "company");
    if (!company) throw new Error("Pick an account or name the company.");
    accountId = (await createAccount({ company, ownerId: text(formData, "ownerId") })).id;
  }
  const link = text(formData, "link");
  const stakeholder = await createStakeholder({
    accountId,
    name,
    linkedinUrl: link && /linkedin\.com\/in\//i.test(link) ? link : null,
    xUrl: link && /(x|twitter)\.com\//i.test(link) ? link : null,
    ownerId: text(formData, "ownerId"),
  });
  await assignActivity(activityId, stakeholder);
  refresh();
}

export async function dismissTouch(activityId: number) {
  await dismissActivity(activityId);
  refresh();
}

export type SyncState = { ok: boolean; message: string } | null;

export async function syncSlackNow(): Promise<SyncState> {
  try {
    const r = await syncKamSlack();
    refresh();
    const parts = [
      `${r.saved} new or edited update${r.saved === 1 ? "" : "s"}`,
      r.logged ? `${r.logged} logged` : null,
      r.needsReview ? `${r.needsReview} need review` : null,
      r.failed ? `${r.failed} failed` : null,
    ].filter(Boolean);
    return { ok: !r.failed, message: parts.join(" · ") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Sync failed." };
  }
}

export async function retryFailedUpdates() {
  await retryFailed();
  refresh();
}

export async function addKamMember(formData: FormData) {
  const name = text(formData, "name");
  if (!name) return;
  await addMember(name);
  refresh();
}

/** "Attribute a lead": link a pipeline lead to a KAM stakeholder. */
export async function attributeLead(leadId: string, formData: FormData) {
  const stakeholderId = text(formData, "stakeholderId");
  if (!stakeholderId) throw new Error("Pick a stakeholder.");
  await attribute(leadId, stakeholderId);
  refresh();
}

export async function unattributeLead(stakeholderId: string) {
  await unattribute(stakeholderId);
  refresh();
}

export async function saveWinNote(leadId: string, formData: FormData) {
  await updateLead(leadId, { winNote: text(formData, "winNote") });
  refresh();
}
