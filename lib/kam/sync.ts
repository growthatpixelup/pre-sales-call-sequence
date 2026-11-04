import "server-only";

import { dashboardTimeZone } from "@/lib/analytics";
import { addDays, localDate } from "@/lib/emails/time";
import { extractTouches } from "./extract";
import { matchAccount, matchStakeholder } from "./match";
import { kamSlackConfig, plainText, readChannel, userProfile, type SlackProfile } from "./slack";
import {
  latestSlackTs,
  listAccounts,
  listMembers,
  listSlackMessages,
  listStakeholders,
  logActivities,
  memberForSlackUser,
  saveSlackMessage,
  setSlackMessageStatus,
  slackMessagesByTs,
  type NewActivity,
  type SlackMessageRow,
} from "./store";

/** Each read goes back this far past the newest stored message, to catch edits and late thread replies. */
const OVERLAP_DAYS = 3;
/** The first read takes this much history. */
const FIRST_READ_DAYS = 14;
const DAY_S = 86_400;

export interface SyncResult {
  read: number;
  saved: number;
  logged: number;
  needsReview: number;
  ignored: number;
  failed: number;
}

/**
 * Reads new and edited updates from the KAM Slack channel, then turns every pending update into
 * touches. Safe to run often: messages are keyed by Slack ts and only re-read when edited.
 */
export async function syncKamSlack(): Promise<SyncResult> {
  const config = kamSlackConfig();
  if (!config) throw new Error("Set SLACK_BOT_TOKEN and SLACK_KAM_CHANNEL to read KAM updates from Slack.");
  const { token, channel } = config;

  const latest = await latestSlackTs(channel);
  const now = Date.now() / 1000;
  const oldest = latest ? Number(latest) - OVERLAP_DAYS * DAY_S : now - FIRST_READ_DAYS * DAY_S;
  const messages = await readChannel(token, channel, oldest.toFixed(6));

  const known = await slackMessagesByTs(channel, messages.map((m) => m.ts));
  const profiles = new Map<string, SlackProfile>();
  const profileOf = async (userId: string) => {
    if (!profiles.has(userId)) profiles.set(userId, await userProfile(token, userId));
    return profiles.get(userId)!;
  };

  let saved = 0;
  for (const m of messages) {
    const stored = known.get(m.ts);
    if (stored && stored.editedTs === m.editedTs) continue;
    const profile = await profileOf(m.userId);
    const member = await memberForSlackUser(m.userId, profile);
    // Mentions read as names.
    const mentions = new Map<string, string>();
    for (const id of m.text.match(/<@([A-Z0-9]+)/g)?.map((x) => x.slice(2)) ?? []) mentions.set(id, (await profileOf(id)).name);
    await saveSlackMessage({
      channel,
      ts: m.ts,
      threadTs: m.threadTs,
      userId: m.userId,
      memberId: member.id,
      text: plainText(m.text, mentions),
      postedAt: new Date(Number(m.ts) * 1000).toISOString(),
      editedTs: m.editedTs,
    });
    saved++;
  }

  const result: SyncResult = { read: messages.length, saved, logged: 0, needsReview: 0, ignored: 0, failed: 0 };
  for (const row of await listSlackMessages(["pending"], 200)) {
    const status = await processMessage(row);
    if (status === "logged") result.logged++;
    else if (status === "needs_review") result.needsReview++;
    else if (status === "ignored") result.ignored++;
    else result.failed++;
  }
  return result;
}

/** Re-reads updates that failed (e.g. Claude was unavailable). */
export async function retryFailed(): Promise<number> {
  const failed = await listSlackMessages(["failed"], 50);
  for (const row of failed) await processMessage(row);
  return failed.length;
}

/** Turns one stored update into touches. Returns its new status. */
export async function processMessage(row: SlackMessageRow): Promise<SlackMessageRow["status"]> {
  try {
    const [members, accounts, stakeholders] = await Promise.all([listMembers(), listAccounts(), listStakeholders()]);
    const member = members.find((m) => m.id === row.memberId);
    const tz = dashboardTimeZone();
    const posted = new Date(row.postedAt);
    const accountName = new Map(accounts.map((a) => [a.id, a.company]));

    const touches = await extractTouches({
      text: row.text,
      member: member?.name ?? "a team member",
      date: new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(posted),
      known: stakeholders.map((s) => ({ stakeholder: s.name, company: accountName.get(s.accountId) ?? "" })),
    });

    if (!touches.length) {
      await setSlackMessageStatus(row.id, "ignored");
      return "ignored";
    }

    const today = localDate(posted, tz);
    const items: NewActivity[] = touches.map((t) => {
      const stakeholder = t.person ? matchStakeholder({ name: t.person, company: t.company, link: t.link }, stakeholders, accounts, row.memberId) : null;
      const account = stakeholder ? null : matchAccount(t.company, accounts);
      return {
        day: t.yesterday ? addDays(today, -1) : today,
        memberId: row.memberId,
        accountId: stakeholder?.accountId ?? account?.id ?? null,
        stakeholderId: stakeholder?.id ?? null,
        type: t.type,
        platform: t.platform,
        count: t.count,
        link: t.link,
        note: t.note,
        personName: stakeholder ? null : t.person,
        companyName: stakeholder || account ? null : t.company,
        source: "slack",
        slackMessageId: row.id,
      };
    });
    await logActivities(items);

    const status = items.some((i) => !i.stakeholderId && i.personName) ? "needs_review" : "logged";
    await setSlackMessageStatus(row.id, status);
    return status;
  } catch (err) {
    console.error("[kam] reading Slack update failed:", err);
    await setSlackMessageStatus(row.id, "failed", err instanceof Error ? err.message : String(err));
    return "failed";
  }
}
