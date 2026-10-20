import "server-only";

import { supabase } from "@/lib/supabase";

/** Replies to the sequence, in the `lead_replies` table (see supabase/migrations/005_pipeline_and_replies.sql). */

export interface LeadReply {
  id: string;
  leadId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  text: string;
  receivedAt: string;
  readAt: string | null;
}

interface Row {
  id: string;
  lead_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  received_at: string;
  read_at: string | null;
}

function fromRow(r: Row): LeadReply {
  return {
    id: r.id,
    leadId: r.lead_id,
    fromEmail: r.from_email,
    fromName: r.from_name,
    subject: r.subject,
    text: r.text_body?.trim() || htmlToText(r.html_body ?? ""),
    receivedAt: r.received_at,
    readAt: r.read_at,
  };
}

function fail(action: string, error: { message: string }): never {
  throw new Error(`Supabase: could not ${action}: ${error.message}`);
}

/** Rough plain text from an HTML-only email, for display. */
function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits a reply into what they wrote and the quoted email below it ("On Mon, … wrote:" or
 * "> " lines), so the dashboard can show the new text first.
 */
export function splitQuoted(text: string): { body: string; quoted: string } {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/i.test(line.trim()) ||
      // Gmail wraps long "On … wrote:" lines.
      (/^On .+/i.test(line.trim()) && /wrote:\s*$/i.test(lines[i + 1]?.trim() ?? "")) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      /^From: .+/i.test(line.trim()) ||
      (line.startsWith(">") && lines.slice(i).every((l) => l.startsWith(">") || !l.trim())),
  );
  if (start <= 0) return { body: text.trim(), quoted: "" };
  return { body: lines.slice(0, start).join("\n").trim(), quoted: lines.slice(start).join("\n").trim() };
}

/** "Jane Doe <jane@acme.io>" → { email: "jane@acme.io", name: "Jane Doe" } */
export function parseAddress(value: string): { email: string; name: string | null } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { email: match[2].trim().toLowerCase(), name: match[1].trim() || null };
  return { email: value.trim().toLowerCase(), name: null };
}

const stripRe = (subject: string) => subject.replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, "").trim();

/**
 * Which lead a reply is from: the most recent lead with the sender's email address, else (e.g.
 * in test mode, where every email goes to you) the one lead that was sent an email with this
 * subject.
 */
export async function matchLead(fromEmail: string, subject: string): Promise<string | null> {
  const db = supabase();
  const byEmail = await db
    .from("leads")
    .select("id")
    .ilike("email", fromEmail.replace(/[\\%_]/g, "\\$&"))
    .order("start_time", { ascending: false })
    .limit(1);
  if (byEmail.error) fail("match reply", byEmail.error);
  if (byEmail.data?.length) return byEmail.data[0].id as string;

  const original = stripRe(subject);
  if (!original) return null;
  const bySubject = await db.from("lead_emails").select("lead_id").eq("status", "sent").eq("subject", original);
  if (bySubject.error) fail("match reply", bySubject.error);
  const leads = new Set((bySubject.data ?? []).map((r) => r.lead_id as string));
  return leads.size === 1 ? [...leads][0] : null;
}

/** Saves a reply. Returns false if it was already saved (Resend retries webhooks). */
export async function saveReply(reply: {
  resendEmailId: string;
  leadId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  text: string | null;
  html: string | null;
  receivedAt: string;
}): Promise<boolean> {
  const { error } = await supabase().from("lead_replies").insert({
    resend_email_id: reply.resendEmailId,
    lead_id: reply.leadId,
    from_email: reply.fromEmail,
    from_name: reply.fromName,
    subject: reply.subject,
    text_body: reply.text,
    html_body: reply.html,
    received_at: reply.receivedAt,
  });
  if (!error) return true;
  // 23505 = unique violation: already saved.
  if (error.code === "23505") return false;
  fail("save reply", error);
}

export async function listReplies(opts: { leadId?: string; unreadOnly?: boolean; limit?: number } = {}) {
  let query = supabase().from("lead_replies").select("*").order("received_at", { ascending: false });
  if (opts.leadId) query = query.eq("lead_id", opts.leadId);
  if (opts.unreadOnly) query = query.is("read_at", null);
  if (opts.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) fail("load replies", error);
  return (data as Row[]).map(fromRow);
}

export async function unreadReplyCount(): Promise<number> {
  const { count, error } = await supabase()
    .from("lead_replies")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) fail("count replies", error);
  return count ?? 0;
}

/** Marks replies read: one reply, every reply from a lead, or all of them. */
export async function markRepliesRead(filter: { id?: string; leadId?: string } = {}) {
  let query = supabase().from("lead_replies").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (filter.id) query = query.eq("id", filter.id);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);
  const { error } = await query;
  if (error) fail("mark replies read", error);
}
