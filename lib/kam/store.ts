import "server-only";

import { normaliseLinkedIn } from "@/lib/leads/dedup";
import { supabase } from "@/lib/supabase";
import { normaliseX } from "./match";
import {
  STAGE_FROM_ACTIVITY,
  kamStageRank,
  type AccountStatus,
  type ActivityType,
  type KamAccount,
  type KamActivity,
  type KamMember,
  type KamStage,
  type KamStakeholder,
  type Platform,
} from "./types";

/** KAM storage (supabase/migrations/011_kam.sql). */

function fail(action: string, error: { message: string }): never {
  throw new Error(`Supabase: could not ${action}: ${error.message}`);
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

const toMember = (r: Row): KamMember => ({
  id: String(r.id),
  name: String(r.name),
  slackUserId: s(r.slack_user_id),
  email: s(r.email),
  active: Boolean(r.active),
});

const toAccount = (r: Row): KamAccount => ({
  id: String(r.id),
  company: String(r.company),
  domain: s(r.domain),
  website: s(r.website),
  ownerId: s(r.owner_id),
  status: r.status as AccountStatus,
  notes: String(r.notes ?? ""),
  createdAt: String(r.created_at),
});

const toStakeholder = (r: Row): KamStakeholder => ({
  id: String(r.id),
  accountId: String(r.account_id),
  name: String(r.name),
  role: s(r.role),
  linkedinUrl: s(r.linkedin_url),
  xUrl: s(r.x_url),
  stage: r.stage as KamStage,
  ownerId: s(r.owner_id),
  leadId: s(r.lead_id),
  notes: String(r.notes ?? ""),
  lastTouchAt: s(r.last_touch_at),
  createdAt: String(r.created_at),
});

const toActivity = (r: Row): KamActivity => ({
  id: Number(r.id),
  day: String(r.day),
  memberId: s(r.member_id),
  accountId: s(r.account_id),
  stakeholderId: s(r.stakeholder_id),
  type: r.type as ActivityType,
  platform: r.platform as Platform,
  count: Number(r.count),
  link: s(r.link),
  note: s(r.note),
  personName: s(r.person_name),
  companyName: s(r.company_name),
  reviewed: Boolean(r.reviewed),
  source: r.source as KamActivity["source"],
  slackMessageId: s(r.slack_message_id),
  createdAt: String(r.created_at),
});

// ---------------------------------------------------------------------------------------------
// Members

export async function listMembers(): Promise<KamMember[]> {
  const { data, error } = await supabase().from("kam_members").select("*").order("name");
  if (error) fail("list KAM members", error);
  return (data as Row[]).map(toMember);
}

/** The member for a Slack user, created on first sight. */
export async function memberForSlackUser(slackUserId: string, profile: { name: string; email: string | null }) {
  const db = supabase();
  const existing = await db.from("kam_members").select("*").eq("slack_user_id", slackUserId).maybeSingle();
  if (existing.error) fail("look up KAM member", existing.error);
  if (existing.data) return toMember(existing.data as Row);

  // Someone added by hand under the same name takes the Slack id.
  const byName = await db.from("kam_members").select("*").ilike("name", profile.name).is("slack_user_id", null).maybeSingle();
  if (byName.error) fail("look up KAM member", byName.error);
  if (byName.data) {
    const { data, error } = await db
      .from("kam_members")
      .update({ slack_user_id: slackUserId, email: profile.email })
      .eq("id", (byName.data as Row).id)
      .select("*")
      .single();
    if (error) fail("link KAM member to Slack", error);
    return toMember(data as Row);
  }

  const { data, error } = await db
    .from("kam_members")
    .insert({ name: profile.name, slack_user_id: slackUserId, email: profile.email })
    .select("*")
    .single();
  if (error) fail("add KAM member", error);
  return toMember(data as Row);
}

export async function addMember(name: string): Promise<KamMember> {
  const { data, error } = await supabase().from("kam_members").insert({ name }).select("*").single();
  if (error) fail("add KAM member", error);
  return toMember(data as Row);
}

// ---------------------------------------------------------------------------------------------
// Accounts and stakeholders

export async function listAccounts(): Promise<KamAccount[]> {
  const { data, error } = await supabase().from("kam_accounts").select("*").order("company");
  if (error) fail("list KAM accounts", error);
  return (data as Row[]).map(toAccount);
}

export async function getAccount(id: string): Promise<KamAccount | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase().from("kam_accounts").select("*").eq("id", id).maybeSingle();
  if (error) fail("load KAM account", error);
  return data ? toAccount(data as Row) : null;
}

export interface AccountFields {
  company: string;
  domain: string | null;
  website: string | null;
  ownerId: string | null;
  status: AccountStatus;
  notes: string;
}

function accountColumns(f: Partial<AccountFields>): Row {
  const c: Row = {};
  if (f.company !== undefined) c.company = f.company.trim();
  if (f.domain !== undefined) c.domain = f.domain;
  if (f.website !== undefined) c.website = f.website;
  if (f.ownerId !== undefined) c.owner_id = f.ownerId;
  if (f.status !== undefined) c.status = f.status;
  if (f.notes !== undefined) c.notes = f.notes;
  return c;
}

export async function createAccount(fields: Partial<AccountFields> & { company: string }): Promise<KamAccount> {
  const { data, error } = await supabase().from("kam_accounts").insert(accountColumns(fields)).select("*").single();
  if (error) {
    if (error.code === "23505") throw new Error(`${fields.company} is already a KAM account.`);
    fail("add KAM account", error);
  }
  return toAccount(data as Row);
}

export async function updateAccount(id: string, fields: Partial<AccountFields>) {
  const { error } = await supabase().from("kam_accounts").update(accountColumns(fields)).eq("id", id);
  if (error) fail("update KAM account", error);
}

export async function listStakeholders(accountId?: string): Promise<KamStakeholder[]> {
  let query = supabase().from("kam_stakeholders").select("*").order("name");
  if (accountId) query = query.eq("account_id", accountId);
  const { data, error } = await query;
  if (error) fail("list stakeholders", error);
  return (data as Row[]).map(toStakeholder);
}

export async function getStakeholder(id: string): Promise<KamStakeholder | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase().from("kam_stakeholders").select("*").eq("id", id).maybeSingle();
  if (error) fail("load stakeholder", error);
  return data ? toStakeholder(data as Row) : null;
}

export interface StakeholderFields {
  accountId: string;
  name: string;
  role: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  stage: KamStage;
  ownerId: string | null;
  leadId: string | null;
  notes: string;
}

function stakeholderColumns(f: Partial<StakeholderFields>): Row {
  const c: Row = {};
  if (f.accountId !== undefined) c.account_id = f.accountId;
  if (f.name !== undefined) c.name = f.name.trim();
  if (f.role !== undefined) c.role = f.role;
  if (f.linkedinUrl !== undefined) c.linkedin_url = normaliseLinkedIn(f.linkedinUrl) ?? f.linkedinUrl;
  if (f.xUrl !== undefined) c.x_url = normaliseX(f.xUrl) ?? f.xUrl;
  if (f.stage !== undefined) c.stage = f.stage;
  if (f.ownerId !== undefined) c.owner_id = f.ownerId;
  if (f.leadId !== undefined) c.lead_id = f.leadId;
  if (f.notes !== undefined) c.notes = f.notes;
  return c;
}

export async function createStakeholder(fields: Partial<StakeholderFields> & { accountId: string; name: string }) {
  const { data, error } = await supabase().from("kam_stakeholders").insert(stakeholderColumns(fields)).select("*").single();
  if (error) fail("add stakeholder", error);
  return toStakeholder(data as Row);
}

export async function updateStakeholder(id: string, fields: Partial<StakeholderFields>) {
  const { error } = await supabase().from("kam_stakeholders").update(stakeholderColumns(fields)).eq("id", id);
  if (error) fail("update stakeholder", error);
}

/** Stakeholders linked to a pipeline lead. */
export async function stakeholdersForLead(leadId: string): Promise<KamStakeholder[]> {
  const { data, error } = await supabase().from("kam_stakeholders").select("*").eq("lead_id", leadId);
  if (error) fail("load stakeholders for lead", error);
  return (data as Row[]).map(toStakeholder);
}

/** Stakeholders linked to any lead (KAM wins). */
export async function stakeholdersWithLeads(): Promise<KamStakeholder[]> {
  const { data, error } = await supabase().from("kam_stakeholders").select("*").not("lead_id", "is", null);
  if (error) fail("load KAM wins", error);
  return (data as Row[]).map(toStakeholder);
}

// ---------------------------------------------------------------------------------------------
// Activity

export interface NewActivity {
  day: string;
  memberId: string | null;
  accountId: string | null;
  stakeholderId: string | null;
  type: ActivityType;
  platform: Platform;
  count?: number;
  link?: string | null;
  note?: string | null;
  personName?: string | null;
  companyName?: string | null;
  source: "manual" | "slack";
  slackMessageId?: string | null;
}

/**
 * Logs touches, then moves each touched stakeholder's last touch and stage forward (never back).
 */
export async function logActivities(items: NewActivity[]): Promise<void> {
  if (!items.length) return;
  const { error } = await supabase()
    .from("kam_activity")
    .insert(
      items.map((a) => ({
        day: a.day,
        member_id: a.memberId,
        account_id: a.accountId,
        stakeholder_id: a.stakeholderId,
        type: a.type,
        platform: a.platform,
        count: Math.max(1, Math.round(a.count ?? 1)),
        link: a.link ?? null,
        note: a.note ?? null,
        person_name: a.personName ?? null,
        company_name: a.companyName ?? null,
        source: a.source,
        slack_message_id: a.slackMessageId ?? null,
      })),
    );
  if (error) fail("log KAM activity", error);
  for (const a of items) if (a.stakeholderId) await applyTouch(a.stakeholderId, a.type, a.day);
}

/** Moves a stakeholder's last touch to `day` and its stage to what the touch implies, if further. */
async function applyTouch(stakeholderId: string, type: ActivityType, day: string) {
  const stakeholder = await getStakeholder(stakeholderId);
  if (!stakeholder) return;
  const changes: Row = {};
  const at = new Date(`${day}T12:00:00Z`).toISOString();
  if (!stakeholder.lastTouchAt || stakeholder.lastTouchAt < at) changes.last_touch_at = at;
  const next = STAGE_FROM_ACTIVITY[type];
  if (next && kamStageRank(next) > kamStageRank(stakeholder.stage)) changes.stage = next;
  if (!Object.keys(changes).length) return;
  const { error } = await supabase().from("kam_stakeholders").update(changes).eq("id", stakeholderId);
  if (error) fail("update stakeholder from activity", error);
}

export async function listActivity(opts: { since?: string; stakeholderId?: string; accountId?: string; limit?: number } = {}) {
  let query = supabase().from("kam_activity").select("*").order("day", { ascending: false }).order("id", { ascending: false });
  if (opts.since) query = query.gte("day", opts.since);
  if (opts.stakeholderId) query = query.eq("stakeholder_id", opts.stakeholderId);
  if (opts.accountId) query = query.eq("account_id", opts.accountId);
  query = query.limit(opts.limit ?? 2000);
  const { data, error } = await query;
  if (error) fail("load KAM activity", error);
  return (data as Row[]).map(toActivity);
}

/** Touches naming someone no stakeholder matches, oldest first. */
export async function listUnmatched(): Promise<KamActivity[]> {
  const { data, error } = await supabase()
    .from("kam_activity")
    .select("*")
    .is("stakeholder_id", null)
    .not("person_name", "is", null)
    .eq("reviewed", false)
    .order("day");
  if (error) fail("load unmatched touches", error);
  return (data as Row[]).map(toActivity);
}

/** Points a touch at a stakeholder (from review), and applies it to their stage and last touch. */
export async function assignActivity(activityId: number, stakeholder: KamStakeholder) {
  const { data, error } = await supabase()
    .from("kam_activity")
    .update({ stakeholder_id: stakeholder.id, account_id: stakeholder.accountId, reviewed: true })
    .eq("id", activityId)
    .select("*")
    .single();
  if (error) fail("assign touch", error);
  const a = toActivity(data as Row);
  await applyTouch(stakeholder.id, a.type, a.day);
}

export async function dismissActivity(activityId: number) {
  const { error } = await supabase().from("kam_activity").update({ reviewed: true }).eq("id", activityId);
  if (error) fail("dismiss touch", error);
}

export async function deleteActivity(activityId: number) {
  const { error } = await supabase().from("kam_activity").delete().eq("id", activityId);
  if (error) fail("delete touch", error);
}

// ---------------------------------------------------------------------------------------------
// Slack messages

export interface SlackMessageRow {
  id: string;
  channel: string;
  ts: string;
  threadTs: string | null;
  userId: string;
  memberId: string | null;
  text: string;
  postedAt: string;
  editedTs: string | null;
  status: "pending" | "logged" | "needs_review" | "ignored" | "failed";
  error: string | null;
}

const toSlack = (r: Row): SlackMessageRow => ({
  id: String(r.id),
  channel: String(r.channel),
  ts: String(r.ts),
  threadTs: s(r.thread_ts),
  userId: String(r.user_id),
  memberId: s(r.member_id),
  text: String(r.text),
  postedAt: String(r.posted_at),
  editedTs: s(r.edited_ts),
  status: r.status as SlackMessageRow["status"],
  error: s(r.error),
});

export async function slackMessagesByTs(channel: string, tsList: string[]): Promise<Map<string, SlackMessageRow>> {
  if (!tsList.length) return new Map();
  const { data, error } = await supabase().from("kam_slack_messages").select("*").eq("channel", channel).in("ts", tsList);
  if (error) fail("load Slack messages", error);
  return new Map((data as Row[]).map((r) => [String(r.ts), toSlack(r)]));
}

/** Saves a message (new, or edited since we read it) as pending, dropping touches from an earlier read. */
export async function saveSlackMessage(m: Omit<SlackMessageRow, "id" | "status" | "error">): Promise<SlackMessageRow> {
  const db = supabase();
  const { data, error } = await db
    .from("kam_slack_messages")
    .upsert(
      {
        channel: m.channel,
        ts: m.ts,
        thread_ts: m.threadTs,
        user_id: m.userId,
        member_id: m.memberId,
        text: m.text,
        posted_at: m.postedAt,
        edited_ts: m.editedTs,
        status: "pending",
        error: null,
        processed_at: null,
      },
      { onConflict: "channel,ts" },
    )
    .select("*")
    .single();
  if (error) fail("save Slack message", error);
  const row = toSlack(data as Row);
  const del = await db.from("kam_activity").delete().eq("slack_message_id", row.id);
  if (del.error) fail("clear touches from an edited message", del.error);
  return row;
}

export async function setSlackMessageStatus(id: string, status: SlackMessageRow["status"], errorText: string | null = null) {
  const { error } = await supabase()
    .from("kam_slack_messages")
    .update({ status, error: errorText, processed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail("update Slack message", error);
}

export async function listSlackMessages(statuses: SlackMessageRow["status"][], limit = 100): Promise<SlackMessageRow[]> {
  const { data, error } = await supabase()
    .from("kam_slack_messages")
    .select("*")
    .in("status", statuses)
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error) fail("load Slack messages", error);
  return (data as Row[]).map(toSlack);
}

/** The newest message ts we've stored, for the next read of the channel. */
export async function latestSlackTs(channel: string): Promise<string | null> {
  const { data, error } = await supabase()
    .from("kam_slack_messages")
    .select("ts")
    .eq("channel", channel)
    .order("posted_at", { ascending: false })
    .limit(1);
  if (error) fail("load latest Slack message", error);
  return data?.length ? String((data[0] as Row).ts) : null;
}
