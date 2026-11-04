import "server-only";

/**
 * Reads #account-based-marketing through the Slack Web API with SLACK_BOT_TOKEN (the same bot
 * that posts booking alerts). The bot needs the groups:history (private channel) and users:read
 * scopes, plus users:read.email for members' emails, and must be a member of SLACK_KAM_CHANNEL.
 */

const API = "https://slack.com/api";

export interface SlackMessage {
  ts: string;
  threadTs: string | null;
  userId: string;
  /** Raw Slack text (mrkdwn, with <url|label> links and <@U123> mentions). */
  text: string;
  editedTs: string | null;
}

interface RawMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  reply_count?: number;
  edited?: { ts?: string };
}

export function kamSlackConfig() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_KAM_CHANNEL;
  return token && channel ? { token, channel } : null;
}

async function call<T>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = (await res.json().catch(() => null)) as ({ ok: boolean; error?: string; needed?: string } & T) | null;
  if (!body?.ok) {
    const why = body?.error ?? `HTTP ${res.status}`;
    throw new Error(`Slack ${method} failed: ${why}${body?.needed ? ` (needs scope ${body.needed})` : ""}`);
  }
  return body;
}

/** People's own messages: not bots or workflows, not joins and other system messages. */
function isHuman(m: RawMessage): m is RawMessage & { user: string } {
  return Boolean(m.user && !m.bot_id && (!m.subtype || m.subtype === "thread_broadcast") && m.text?.trim());
}

const toMessage = (m: RawMessage & { user: string }): SlackMessage => ({
  ts: m.ts,
  threadTs: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null,
  userId: m.user,
  text: m.text ?? "",
  editedTs: m.edited?.ts ?? null,
});

/**
 * Every human message posted since `oldest` (a Slack ts): top-level posts and thread replies,
 * including replies to the 6 PM workflow prompt.
 */
export async function readChannel(token: string, channel: string, oldest: string): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  const threads: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const body = await call<{ messages: RawMessage[]; response_metadata?: { next_cursor?: string } }>(
      token,
      "conversations.history",
      { channel, oldest, limit: "200", ...(cursor ? { cursor } : {}) },
    );
    for (const m of body.messages) {
      if (isHuman(m)) out.push(toMessage(m));
      if (m.reply_count) threads.push(m.ts);
    }
    cursor = body.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }

  for (const thread of threads) {
    let replyCursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const body = await call<{ messages: RawMessage[]; response_metadata?: { next_cursor?: string } }>(
        token,
        "conversations.replies",
        { channel, ts: thread, oldest, limit: "200", ...(replyCursor ? { cursor: replyCursor } : {}) },
      );
      // The first message is the thread's parent, already read above.
      for (const m of body.messages) if (m.ts !== thread && isHuman(m)) out.push(toMessage(m));
      replyCursor = body.response_metadata?.next_cursor || undefined;
      if (!replyCursor) break;
    }
  }
  return out;
}

export interface SlackProfile {
  name: string;
  email: string | null;
}

export async function userProfile(token: string, userId: string): Promise<SlackProfile> {
  const body = await call<{ user: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string; email?: string } } }>(
    token,
    "users.info",
    { user: userId },
  );
  const u = body.user;
  const name = u.profile?.real_name || u.real_name || u.profile?.display_name || u.name || userId;
  return { name, email: u.profile?.email ?? null };
}

/** Slack markup as plain text: "<https://x.com/a|Jane's post>" → "Jane's post (https://x.com/a)", mentions → "@Name". */
export function plainText(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${names.get(id) ?? id}`)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url: string, label: string) => (label === url ? url : `${label} (${url})`))
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
